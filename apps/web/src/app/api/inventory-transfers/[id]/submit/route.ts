import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { inventoryTransferSubmitSchema } from '@/lib/api/schemas';
import { maybeTriggerInventoryTransferApproval } from '@/lib/inventory-transfer/workflow-sync';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inventory-transfers/:id/submit —— DRAFT → SUBMITTED（CTO 6B-2 Transfer Vertical Slice）
 * - 校验：仅 DRAFT；至少一条有效 Line；quantity > 0；源/目标 warehouse/location 有效（组合 FK）；自调拨防护
 * - 命中 ApprovalPolicy(module=INVENTORY_TRANSFER) → 创建/复用 WorkflowInstance（单实例 + 多轮重提，对齐 PO 模式）
 * - 未命中策略 → **直接完成审批投影**（status=APPROVED + approvedById=提交人）——严格沿用项目既有 Workflow Policy
 *   语义，不在 Transfer 单独发明第二套审批规则
 * - **红线：APPROVED ≠ EXECUTED（对齐 PO APPROVED ≠ CONFIRMED）**——submit/approve 绝不自动落账，
 *   只有显式 POST /api/inventory-transfers/{id}/execute 才经 Shared LedgerCommand 双 atom 落账
 * - **movementGroupId 只能在 EXECUTE 时生成**，submit 阶段绝不提前生成
 * - 事件：本阶段 Transfer 业务层事件仅 InventoryTransferExecuted（EVENTS v1.28）；submit/approve 仅 AuditLog
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // submit 映射现有动作（submit→:edit，不新造权限体系——对齐 5A/5B 拍板）
  const denied = requirePermission(user, 'inventory-transfer:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'inventory-transfer.submit');

  const { id } = await params;
  const parsed = inventoryTransferSubmitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const result = await prisma.$transaction(async (tx) => {
    // ① Lock Transfer（FOR UPDATE）
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "InventoryTransfer" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: 'NOT_FOUND' as const };

    const transfer = await tx.inventoryTransfer.findFirst({
      where: { id, deletedAt: null },
      include: {
        lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!transfer) return { error: 'NOT_FOUND' as const };

    // ② 状态门禁：仅 DRAFT
    if (transfer.status !== 'DRAFT') {
      return { error: 'INVALID_STATE' as const, status: transfer.status };
    }
    // ③ CAS version
    if (transfer.version !== version) {
      return { error: 'VERSION_CONFLICT' as const };
    }
    // ④ 至少一条有效 Line + quantity>0
    if (transfer.lines.length === 0) {
      return { error: 'NO_LINES' as const };
    }
    const invalidQty = transfer.lines.some((l) => l.quantity.lte(0));
    if (invalidQty) {
      return { error: 'QUANTITY_INVALID' as const };
    }

    // ⑤ 源/目标 warehouse/location 执行前复核（组合 FK；已由 Create/Update 校验，此处防御性复核）
    const [sourceWh, destWh] = await Promise.all([
      tx.warehouse.findFirst({ where: { id: transfer.sourceWarehouseId, deletedAt: null } }),
      tx.warehouse.findFirst({ where: { id: transfer.destinationWarehouseId, deletedAt: null } }),
    ]);
    if (!sourceWh || !destWh) {
      return { error: 'WAREHOUSE_INVALID' as const };
    }
    if (transfer.sourceLocationId) {
      const loc = await tx.warehouseLocation.findFirst({
        where: { id: transfer.sourceLocationId, warehouseId: transfer.sourceWarehouseId, deletedAt: null },
      });
      if (!loc) return { error: 'LOCATION_INVALID' as const };
    }
    if (transfer.destinationLocationId) {
      const loc = await tx.warehouseLocation.findFirst({
        where: { id: transfer.destinationLocationId, warehouseId: transfer.destinationWarehouseId, deletedAt: null },
      });
      if (!loc) return { error: 'LOCATION_INVALID' as const };
    }
    // 自调拨防护（同仓同库位含都 NULL）
    if (
      transfer.sourceWarehouseId === transfer.destinationWarehouseId &&
      (transfer.sourceLocationId ?? null) === (transfer.destinationLocationId ?? null)
    ) {
      return { error: 'SELF_TRANSFER' as const };
    }

    // ⑥ DRAFT → SUBMITTED（CAS：id + version + status=DRAFT 同时命中）
    const submitted = await tx.inventoryTransfer.updateMany({
      where: { id, version, status: 'DRAFT', deletedAt: null },
      data: { status: 'SUBMITTED', updatedById: actorId, version: { increment: 1 } },
    });
    if (submitted.count !== 1) {
      return { error: 'VERSION_CONFLICT' as const };
    }

    // ⑦ 条件触发审批（同事务；命中策略 → 回写 SUBMITTED + 创建实例；未命中 → skipped）
    const wf = await maybeTriggerInventoryTransferApproval({
      transferId: transfer.id,
      actorId,
      meta,
      tx,
    });

    // ⑧ 未命中策略/规则 → 直接完成审批投影（status=APPROVED + approvedById=提交人；**绝不 EXECUTED**）
    if (wf.skipped === 'no-policy' || wf.skipped === 'no-rule-matched') {
      await tx.inventoryTransfer.update({
        where: { id: transfer.id },
        data: {
          status: 'APPROVED',
          approvedById: actorId,
          updatedById: actorId,
        },
      });
    }

    const finalTransfer = await tx.inventoryTransfer.findFirstOrThrow({
      where: { id: transfer.id, deletedAt: null },
      include: {
        sourceWarehouse: { select: { id: true, code: true, name: true } },
        destinationWarehouse: { select: { id: true, code: true, name: true } },
        lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      },
    });
    return { transfer: finalTransfer, workflow: wf };
  }).catch((e: Error) => {
    if (e.message === 'WORKFLOW_DEFINITION_NOT_FOUND') {
      return { error: 'WORKFLOW_FAILED' as const };
    }
    throw e;
  });

  if ('error' in result) {
    switch (result.error) {
      case 'NOT_FOUND':
        return failNotFound(ERROR_CODES.INVENTORY_TRANSFER_NOT_FOUND, '调拨单不存在');
      case 'INVALID_STATE':
        return failConflict(
          ERROR_CODES.INVENTORY_TRANSFER_INVALID_STATE,
          `仅 DRAFT 状态可提交（当前 ${(result as { status?: string }).status ?? '未知'}）`,
        );
      case 'VERSION_CONFLICT':
        return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试');
      case 'NO_LINES':
        return fail(ERROR_CODES.INVENTORY_TRANSFER_NO_LINES, '调拨单至少需要一条有效行', 400);
      case 'QUANTITY_INVALID':
        return fail(ERROR_CODES.INVENTORY_TRANSFER_QUANTITY_INVALID, '调拨数量必须 > 0', 400);
      case 'WAREHOUSE_INVALID':
        return fail(ERROR_CODES.INVENTORY_TRANSFER_WAREHOUSE_INVALID, '源/目标仓库不存在或已停用', 400);
      case 'LOCATION_INVALID':
        return fail(ERROR_CODES.INVENTORY_TRANSFER_LOCATION_INVALID, '库位不存在或不属于对应仓库', 400);
      case 'SELF_TRANSFER':
        return failConflict(ERROR_CODES.INVENTORY_TRANSFER_SELF_TRANSFER, '不能向同一仓库同一库位调拨（五维全等无实际转移）');
      case 'WORKFLOW_FAILED':
        return fail(ERROR_CODES.INTERNAL_ERROR, '审批策略命中但工作流配置异常（WORKFLOW_DEFINITION_NOT_FOUND）', 500);
      default:
        return fail(ERROR_CODES.INTERNAL_ERROR, '提交调拨单失败', 500);
    }
  }

  await writeAuditLog({
    actorId,
    action: 'inventory-transfer:submit',
    entityType: 'inventory-transfer',
    entityId: result.transfer.id,
    afterData: {
      transferNo: result.transfer.transferNo,
      status: result.transfer.status,
      approvedById: result.transfer.approvedById,
      workflow: result.workflow,
    },
    meta,
  });

  return ok({ transfer: result.transfer, workflow: result.workflow });
}
