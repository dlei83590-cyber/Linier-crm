import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { inventoryAdjustmentSubmitSchema } from '@/lib/api/schemas';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inventory-adjustments/:id/submit —— DRAFT → SUBMITTED（CTO 6B-3 Adjustment API/Workflow）
 * - 校验：仅 DRAFT；至少一条有效 Line；quantity > 0；warehouse/location/item 有效（组合 FK）；来源一致性（Minor Hardening ②）
 * - **auto-approve（移除审核：提交即生效）**：DRAFT → APPROVED 同事务（跳过 ApprovalPolicy/Workflow）；
 *   **maker-checker（P9 Final + DB CHECK 兜底）**：approvedById 不得 = createdById——若提交人=创建人，
 *   approvedById 留空（无审批流 = 无具体审批人；Apply 时由 apply 人补录 approvedById=appliedById，且 apply 人 ≠ 创建人）
 * - **红线：APPROVED ≠ APPLIED（对齐 Transfer APPROVED ≠ EXECUTED）**——submit/approve 绝不自动落账，
 *   只有显式 POST /api/inventory-adjustments/{id}/apply 才经 Shared LedgerCommand 逐行 ADJUSTMENT Movement 落账
 * - 事件：本阶段 Adjustment 业务层事件仅 InventoryAdjustmentApplied（EVENTS v1.28）；submit/approve 仅 AuditLog
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // submit 映射现有动作（submit→:edit，不新造权限体系——对齐 5A/5B/6B-2 拍板）
  const denied = requirePermission(user, 'inventory-adjustment:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'inventory-adjustment.submit');

  const { id } = await params;
  const parsed = inventoryAdjustmentSubmitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const result = await prisma.$transaction(async (tx) => {
    // ① Lock Adjustment（FOR UPDATE）
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "InventoryAdjustment" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: 'NOT_FOUND' as const };

    const adjustment = await tx.inventoryAdjustment.findFirst({
      where: { id, deletedAt: null },
      include: {
        lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!adjustment) return { error: 'NOT_FOUND' as const };

    // ② 状态门禁：仅 DRAFT
    if (adjustment.status !== 'DRAFT') {
      return { error: 'INVALID_STATE' as const, status: adjustment.status };
    }
    // ③ CAS version
    if (adjustment.version !== version) {
      return { error: 'VERSION_CONFLICT' as const };
    }
    // ④ 至少一条有效 Line + quantity>0
    if (adjustment.lines.length === 0) {
      return { error: 'NO_LINES' as const };
    }
    const invalidQty = adjustment.lines.some((l) => l.quantity.lte(0));
    if (invalidQty) {
      return { error: 'QUANTITY_INVALID' as const };
    }

    // ⑤ warehouse/location/item 执行前复核（组合 FK；已由 Create/Update 校验，此处防御性复核）
    for (const l of adjustment.lines) {
      const wh = await tx.warehouse.findFirst({ where: { id: l.warehouseId, deletedAt: null } });
      if (!wh) return { error: 'WAREHOUSE_INVALID' as const };
      if (l.locationId) {
        const loc = await tx.warehouseLocation.findFirst({
          where: { id: l.locationId, warehouseId: l.warehouseId, deletedAt: null },
        });
        if (!loc) return { error: 'LOCATION_INVALID' as const };
      }
      const item = await tx.item.findFirst({ where: { id: l.itemId, deletedAt: null } });
      if (!item) return { error: 'ITEM_INVALID' as const };
    }

    // ⑥ auto-approve（移除审核：提交即生效——DRAFT → APPROVED 同事务（CAS：id + version + status=DRAFT 同时命中）；
    //    **绝不自动 APPLIED**——apply 门禁 status=APPROVED，只有显式 apply 才落账；
    //    **maker-checker**：提交人=创建人时 approvedById 留空（无审批流则无具体审批人，Apply 时由 apply 人（≠创建人）补录））
    const submitted = await tx.inventoryAdjustment.updateMany({
      where: { id, version, status: 'DRAFT', deletedAt: null },
      data: {
        status: 'APPROVED',
        // maker-checker：approvedById 不得 = createdById（DB CHECK 兜底）；提交人=创建人 → 留空
        approvedById: actorId !== adjustment.createdById ? actorId : null,
        updatedById: actorId,
        version: { increment: 1 },
      },
    });
    if (submitted.count !== 1) {
      return { error: 'VERSION_CONFLICT' as const };
    }

    const wf = { skipped: 'no-policy' as const, resubmitted: false as const };

    const finalAdjustment = await tx.inventoryAdjustment.findFirstOrThrow({
      where: { id: adjustment.id, deletedAt: null },
      include: {
        sourceStockCount: { select: { id: true, countNo: true, status: true } },
        lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      },
    });
    return { adjustment: finalAdjustment, workflow: wf };
  }).catch((e: Error) => {
    if (e.message === 'WORKFLOW_DEFINITION_NOT_FOUND') {
      return { error: 'WORKFLOW_FAILED' as const };
    }
    throw e;
  });

  if ('error' in result) {
    switch (result.error) {
      case 'NOT_FOUND':
        return failNotFound(ERROR_CODES.INVENTORY_ADJUSTMENT_NOT_FOUND, '调整单不存在');
      case 'INVALID_STATE':
        return failConflict(
          ERROR_CODES.INVENTORY_ADJUSTMENT_INVALID_STATE,
          `仅 DRAFT 状态可提交（当前 ${(result as { status?: string }).status ?? '未知'}）`,
        );
      case 'VERSION_CONFLICT':
        return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试');
      case 'NO_LINES':
        return fail(ERROR_CODES.INVENTORY_ADJUSTMENT_NO_LINES, '调整单至少需要一条有效行', 400);
      case 'QUANTITY_INVALID':
        return fail(ERROR_CODES.INVENTORY_ADJUSTMENT_QUANTITY_INVALID, '调整数量必须 > 0', 400);
      case 'WAREHOUSE_INVALID':
        return fail(ERROR_CODES.INVENTORY_ADJUSTMENT_WAREHOUSE_INVALID, '仓库不存在或已停用', 400);
      case 'LOCATION_INVALID':
        return fail(ERROR_CODES.INVENTORY_ADJUSTMENT_LOCATION_INVALID, '库位不存在或不属于对应仓库', 400);
      case 'ITEM_INVALID':
        return fail(ERROR_CODES.INVENTORY_ADJUSTMENT_ITEM_INVALID, '物料不存在或已停用', 400);
      case 'WORKFLOW_FAILED':
        return fail(ERROR_CODES.INTERNAL_ERROR, '审批策略命中但工作流配置异常（WORKFLOW_DEFINITION_NOT_FOUND）', 500);
      default:
        return fail(ERROR_CODES.INTERNAL_ERROR, '提交调整单失败', 500);
    }
  }

  await writeAuditLog({
    actorId,
    action: 'inventory-adjustment:submit',
    entityType: 'inventory-adjustment',
    entityId: result.adjustment.id,
    afterData: {
      adjustmentNo: result.adjustment.adjustmentNo,
      status: result.adjustment.status,
      approvedById: result.adjustment.approvedById,
      workflow: result.workflow,
    },
    meta,
  });

  return ok({ adjustment: result.adjustment, workflow: result.workflow });
}
