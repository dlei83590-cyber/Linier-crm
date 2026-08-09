import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta } from '@/lib/api-helpers';
import { ok, fail, failValidation, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { warehouseReceiptPostSchema } from '@/lib/api/schemas';
import {
  computeInspectionUsedQty,
  computeInspectionAvailableQty,
} from '@/lib/warehouse-receipt/helpers';
import { publishWarehouseReceiptEvent } from '@/lib/warehouse-receipt/events';

export const dynamic = 'force-dynamic';

/**
 * POST /api/warehouse-receipts/:id/post —— **CTO Gate（WarehouseReceipt Posted）**
 * 硬约束（CTO #7135 + ADR-0024）：
 * - **DRAFT ≠ POSTED**：只有 POSTED 才触发 6A InventoryMovement(IN)（D10）；本 API **不创建/不写 InventoryMovement / Stock**（6A 唯一事实源）；
 * - 幂等：已 POSTED → 409 `WAREHOUSE_RECEIPT_ALREADY_POSTED`（重复 Post 拒绝）；CANCELLED → 409 INVALID_STATE；
 * - 事务锁：`FOR UPDATE` 锁 WarehouseReceipt + 涉及 Inspection 行（防并发超入）；
 * - 再次校验来源 Inspection 已完成（result ≠ PENDING）+ qualifiedQty > 0 + 属于同一收货行；
 * - **累计入库不得超余额**：本单行 + 其他非 CANCELLED 单已占用 ≤ qualifiedQty（POST 时本单行计入占用——Create/PATCH 时本单未过账不占额度）；
 * - CAS：`id + version + status=DRAFT` 同时命中才更新，成功 `version: { increment: 1 }`；
 * - 事件：只有 POST 事务成功提交后才发 `WarehouseReceiptPosted`（EVENTS.md 2.3.9；载荷含入库单/来源收货/仓库库位/操作人/时间，**不含库存余额**）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // post 是入库事实落定动作（普通入库不走审批 P1b → :edit，对齐 receive/complete 先例）
  const denied = requirePermission(user, 'warehouse-receipt:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'warehouse-receipt.post');

  const { id } = await params;
  const parsed = warehouseReceiptPostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const result = await prisma.$transaction(async (tx) => {
    // ① Lock WarehouseReceipt（FOR UPDATE）
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "WarehouseReceipt" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: 'NOT_FOUND' as const };

    const receipt = await tx.warehouseReceipt.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        code: true,
        status: true,
        version: true,
        purchaseReceiptId: true,
        warehouseId: true,
        locationId: true,
      },
    });
    if (!receipt) return { error: 'NOT_FOUND' as const };

    // ② 状态 Gate + 幂等：仅 DRAFT 可 Post；已 POSTED → 409；CANCELLED → 409
    if (receipt.status === 'POSTED') {
      return { error: 'ALREADY_POSTED' as const, status: receipt.status };
    }
    if (receipt.status !== 'DRAFT') {
      return { error: 'INVALID_STATE' as const, status: receipt.status };
    }

    // ③ 行级校验（FOR UPDATE 锁 Inspection 后重算余额：本单行 + 其他非 CANCELLED 单已占用 ≤ qualifiedQty）
    const lines = await tx.warehouseReceiptLine.findMany({
      where: { warehouseReceiptId: id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, purchaseReceiptLineId: true, inspectionId: true, quantity: true },
    });
    if (lines.length === 0) {
      return { error: 'NO_LINES' as const };
    }
    const inspectionIds = [...new Set(lines.map((l) => l.inspectionId))];
    for (const insId of inspectionIds) {
      const inspection = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "Inspection" WHERE "id" = ${insId} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (inspection.length === 0) return { error: 'INSPECTION_NOT_FOUND' as const };
    }
    const inspections = await tx.inspection.findMany({
      where: { id: { in: inspectionIds }, deletedAt: null },
      select: { id: true, purchaseReceiptLineId: true, result: true, qualifiedQty: true },
    });
    const inspectionById = new Map(inspections.map((i) => [i.id, i]));
    for (const line of lines) {
      const inspection = inspectionById.get(line.inspectionId);
      if (!inspection) return { error: 'INSPECTION_NOT_FOUND' as const };
      if (inspection.result === 'PENDING') return { error: 'INSPECTION_NOT_COMPLETED' as const };
      if (inspection.qualifiedQty.lte(0)) return { error: 'INSPECTION_NO_QUALIFIED' as const };
      if (inspection.purchaseReceiptLineId !== line.purchaseReceiptLineId) {
        return { error: 'INSPECTION_MISMATCH' as const };
      }
      // 累计占用 = 本单行 + 其他非 CANCELLED 单（POST 时本单行计入占用，防并发超入）
      const usedQty = await computeInspectionUsedQty(tx, inspection.id); // 含本单（未排除）
      if (line.quantity.gt(computeInspectionAvailableQty(inspection.qualifiedQty, usedQty))) {
        return { error: 'OVER_INSPECTION_BALANCE' as const };
      }
    }

    // ④ CAS 落定：id + version + status=DRAFT 原子条件；成功递增 version（幂等防并发双 Post）
    const postedAt = new Date();
    const cas = await tx.warehouseReceipt.updateMany({
      where: { id, version, status: 'DRAFT', deletedAt: null },
      data: {
        status: 'POSTED',
        postedAt,
        postedById: actorId,
        updatedById: actorId,
        version: { increment: 1 },
      },
    });
    if (cas.count !== 1) {
      return { error: 'VERSION_CONFLICT' as const };
    }

    return {
      ok: true as const,
      warehouseReceiptId: receipt.id,
      warehouseReceiptCode: receipt.code,
      purchaseReceiptId: receipt.purchaseReceiptId,
      warehouseId: receipt.warehouseId,
      locationId: receipt.locationId,
      postedAt: postedAt.toISOString(),
    };
  });

  if ('error' in result) {
    switch (result.error) {
      case 'NOT_FOUND':
        return failNotFound(ERROR_CODES.WAREHOUSE_RECEIPT_NOT_FOUND, '入库单不存在');
      case 'ALREADY_POSTED':
        return failConflict(
          ERROR_CODES.WAREHOUSE_RECEIPT_ALREADY_POSTED,
          '入库单已过账（POSTED），禁止重复 Post（幂等）',
        );
      case 'INVALID_STATE':
        return failConflict(
          ERROR_CODES.WAREHOUSE_RECEIPT_INVALID_STATE,
          `仅 DRAFT 状态可过账（当前 ${result.status}）`,
        );
      case 'NO_LINES':
        return fail(ERROR_CODES.WAREHOUSE_RECEIPT_NO_LINES, '入库单没有行，无法过账', 400);
      case 'INSPECTION_NOT_FOUND':
        return fail(ERROR_CODES.WAREHOUSE_RECEIPT_INSPECTION_NOT_FOUND, '质检记录不存在或已删除', 409);
      case 'INSPECTION_NOT_COMPLETED':
        return failConflict(
          ERROR_CODES.WAREHOUSE_RECEIPT_INSPECTION_NOT_COMPLETED,
          '来源 Inspection 必须已完成（result ≠ PENDING）才能过账入库',
        );
      case 'INSPECTION_NO_QUALIFIED':
        return failConflict(
          ERROR_CODES.WAREHOUSE_RECEIPT_INSPECTION_NO_QUALIFIED,
          '来源 Inspection 无合格数量（qualifiedQty <= 0），无可入库数量',
        );
      case 'INSPECTION_MISMATCH':
        return failConflict(
          ERROR_CODES.WAREHOUSE_RECEIPT_INSPECTION_MISMATCH,
          'Inspection 不属于同一收货行（组合 FK 语义）',
        );
      case 'OVER_INSPECTION_BALANCE':
        return failConflict(
          ERROR_CODES.WAREHOUSE_RECEIPT_OVER_INSPECTION_BALANCE,
          '累计入库超过 Inspection 可入库余额（qualifiedQty - 已占用）',
        );
      case 'VERSION_CONFLICT':
        return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试（并发修改）');
      default:
        return failConflict(ERROR_CODES.CONFLICT, '过账失败');
    }
  }

  // ⑤ 事务成功提交后发布事件（规则⑧/D10：只有 POST 成功后发 WarehouseReceiptPosted；载荷对齐 EVENTS.md 2.3.9）
  try {
    await publishWarehouseReceiptEvent({
      eventType: 'WarehouseReceiptPosted',
      actorId,
      entityId: result.warehouseReceiptId,
      payload: {
        warehouseReceiptId: result.warehouseReceiptId,
        warehouseReceiptCode: result.warehouseReceiptCode,
        purchaseReceiptId: result.purchaseReceiptId,
        warehouseId: result.warehouseId,
        locationId: result.locationId,
        postedById: actorId,
        postedAt: result.postedAt,
      },
      meta,
    });
  } catch {
    // 事件总线未落地（Known Risk）：发布失败不阻断业务事实（事务已提交）；生产前升级 Transactional Outbox（CTO #7045 债务记录）
  }

  // ⑥ 显式 AuditLog（Audit 与 Domain Event 分离，有 Event 不省 Audit——CTO #7115 Minor 教训沿用）
  await prisma.auditLog
    .create({
      data: {
        actorId,
        action: 'WarehouseReceiptPosted',
        entityType: 'warehouse-receipt',
        entityId: result.warehouseReceiptId,
        afterData: {
          warehouseReceiptId: result.warehouseReceiptId,
          warehouseReceiptCode: result.warehouseReceiptCode,
          purchaseReceiptId: result.purchaseReceiptId,
          warehouseId: result.warehouseId,
          locationId: result.locationId,
          postedById: actorId,
          postedAt: result.postedAt,
        },
        meta,
      },
    })
    .catch(() => undefined);

  return ok({
    id: result.warehouseReceiptId,
    code: result.warehouseReceiptCode,
    status: 'POSTED',
    postedAt: result.postedAt,
  });
}
