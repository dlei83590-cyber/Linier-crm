import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { purchaseReturnReturnSchema } from '@/lib/api/schemas';
import {
  computeSourceReturnedQty,
  computeSourceAvailableQty,
} from '@/lib/purchase-return/helpers';
import { publishPurchaseReturnEvent } from '@/lib/purchase-return/events';

export const dynamic = 'force-dynamic';

/**
 * POST /api/purchase-returns/:id/return —— **CTO Gate（PurchaseReturn Returned）**
 * 硬约束（CTO #7219 + ADR-0024）：
 * - **必须有真实来源**：RECEIPT_LINE / INSPECTION = 未入库退货（不碰库存）；WAREHOUSE_RECEIPT_LINE = 已入库退货
 *   （必须来自 **POSTED** 入库事实，SOURCE_NOT_RETURNABLE）；本 API **不得写 InventoryMovement(OUT)**（6A 唯一事实源）；
 * - **防并发超退**：`FOR UPDATE` 锁 PurchaseReturn + 涉及的真实来源行（PurchaseReceiptLine / WarehouseReceiptLine / Inspection），
 *   **锁内重算累计 RETURNED**（仅 RETURNED 单占用；本单 DRAFT 未过账不计入，不双计）→ 本单行 ≤ 来源可退余额；
 * - **disposition**：REPLACE_REQUIRED（供应商仍欠货，重开 PO 履约剩余——PO 投影回写属后续/5B 聚合域，本版仅记录处置语义）；
 *   CREDIT_ONLY（采购数量最终减少/财务冲减，不自动重开待交）；
 * - CAS：`id + version + status=DRAFT` 同时命中才更新，成功 `version: { increment: 1 }` + returnedAt/returnedById；
 * - 幂等：已 RETURNED → 409 `PURCHASE_RETURN_ALREADY_RETURNED`；CANCELLED → 409 INVALID_STATE；
 * - 事件：只有 return 事务成功提交后才发 `PurchaseReturned`（EVENTS.md 2.3.9；载荷含退货单/来源 PO/供应商/类型/处置/操作人/时间，**不含库存余额**）；
 * - 红线：**5B 禁写 Stock / InventoryMovement**（6A 唯一事实源）；财务冲减/红字发票/AP 属 5C。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // return 是退货事实落定动作（普通退货不走审批 P1b → :edit，对齐 receive/complete/post 先例；特殊退货才走 Workflow + :approve）
  const denied = requirePermission(user, 'purchase-return:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-return.return');

  const { id } = await params;
  const parsed = purchaseReturnReturnSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const result = await prisma.$transaction(async (tx) => {
    // ① Lock PurchaseReturn（FOR UPDATE）
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "PurchaseReturn" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: 'NOT_FOUND' as const };

    const pr = await tx.purchaseReturn.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        code: true,
        status: true,
        version: true,
        purchaseOrderId: true,
        supplierId: true,
        returnType: true,
      },
    });
    if (!pr) return { error: 'NOT_FOUND' as const };

    // ② 状态 Gate + 幂等：仅 DRAFT 可 Return；已 RETURNED → 409；CANCELLED → 409
    if (pr.status === 'RETURNED') {
      return { error: 'ALREADY_RETURNED' as const, status: pr.status };
    }
    if (pr.status !== 'DRAFT') {
      return { error: 'INVALID_STATE' as const, status: pr.status };
    }

    // ③ 行级校验（FOR UPDATE 锁真实来源后重算累计 RETURNED，防并发超退）
    const lines = await tx.purchaseReturnLine.findMany({
      where: { purchaseReturnId: id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        sourceRefType: true,
        sourcePurchaseReceiptLineId: true,
        sourceWarehouseReceiptLineId: true,
        sourceInspectionId: true,
        quantity: true,
        disposition: true,
        returnReason: true,
      },
    });
    if (lines.length === 0) {
      return { error: 'NO_LINES' as const };
    }

    // 锁真实来源行（按来源类型分组，逐一 FOR UPDATE）
    const receiptLineIds = [...new Set(lines.filter((l) => l.sourceRefType === 'RECEIPT_LINE').map((l) => l.sourcePurchaseReceiptLineId!).filter(Boolean))];
    const warehouseLineIds = [...new Set(lines.filter((l) => l.sourceRefType === 'WAREHOUSE_RECEIPT_LINE').map((l) => l.sourceWarehouseReceiptLineId!).filter(Boolean))];
    const inspectionIds = [...new Set(lines.filter((l) => l.sourceRefType === 'INSPECTION').map((l) => l.sourceInspectionId!).filter(Boolean))];

    for (const srcId of receiptLineIds) {
      const r = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "PurchaseReceiptLine" WHERE "id" = ${srcId} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (r.length === 0) return { error: 'SOURCE_INVALID' as const };
    }
    for (const srcId of warehouseLineIds) {
      const r = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "WarehouseReceiptLine" WHERE "id" = ${srcId} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (r.length === 0) return { error: 'SOURCE_INVALID' as const };
    }
    for (const srcId of inspectionIds) {
      const r = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "Inspection" WHERE "id" = ${srcId} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (r.length === 0) return { error: 'SOURCE_INVALID' as const };
    }

    // 来源事实读取（含状态/归属/可退上限）
    const [receiptLines, warehouseLines, inspections] = await Promise.all([
      receiptLineIds.length
        ? tx.purchaseReceiptLine.findMany({
            where: { id: { in: receiptLineIds }, deletedAt: null },
            select: { id: true, quantity: true, purchaseReceipt: { select: { purchaseOrderId: true } } },
          })
        : Promise.resolve([]),
      warehouseLineIds.length
        ? tx.warehouseReceiptLine.findMany({
            where: { id: { in: warehouseLineIds }, deletedAt: null },
            select: {
              id: true,
              quantity: true,
              warehouseReceipt: {
                select: { status: true, purchaseReceipt: { select: { purchaseOrderId: true } } },
              },
            },
          })
        : Promise.resolve([]),
      inspectionIds.length
        ? tx.inspection.findMany({
            where: { id: { in: inspectionIds }, deletedAt: null },
            select: { id: true, result: true, qualifiedQty: true, purchaseReceiptLine: { select: { purchaseReceipt: { select: { purchaseOrderId: true } } } } },
          })
        : Promise.resolve([]),
    ]);
    const rlById = new Map(receiptLines.map((r) => [r.id, r]));
    const wlById = new Map(warehouseLines.map((w) => [w.id, w]));
    const insById = new Map(inspections.map((i) => [i.id, i]));

    for (const line of lines) {
      let returnableQty: Prisma.Decimal;
      if (line.sourceRefType === 'RECEIPT_LINE') {
        const src = rlById.get(line.sourcePurchaseReceiptLineId!);
        if (!src) return { error: 'SOURCE_INVALID' as const };
        if (src.purchaseReceipt.purchaseOrderId !== pr.purchaseOrderId) {
          return { error: 'SOURCE_MISMATCH' as const };
        }
        returnableQty = src.quantity;
      } else if (line.sourceRefType === 'WAREHOUSE_RECEIPT_LINE') {
        const src = wlById.get(line.sourceWarehouseReceiptLineId!);
        if (!src) return { error: 'SOURCE_INVALID' as const };
        if (src.warehouseReceipt.status !== 'POSTED') {
          return { error: 'SOURCE_NOT_RETURNABLE' as const };
        }
        if (src.warehouseReceipt.purchaseReceipt.purchaseOrderId !== pr.purchaseOrderId) {
          return { error: 'SOURCE_MISMATCH' as const };
        }
        returnableQty = src.quantity;
      } else {
        const src = insById.get(line.sourceInspectionId!);
        if (!src) return { error: 'SOURCE_INVALID' as const };
        if (src.result === 'PENDING') {
          return { error: 'SOURCE_NOT_RETURNABLE' as const };
        }
        if (src.purchaseReceiptLine.purchaseReceipt.purchaseOrderId !== pr.purchaseOrderId) {
          return { error: 'SOURCE_MISMATCH' as const };
        }
        returnableQty = src.qualifiedQty;
      }
      // **防并发超退**：锁内重算累计 RETURNED（仅 RETURNED 单占用；本单 DRAFT 未过账不计入，不双计）
      const sourceId = line.sourcePurchaseReceiptLineId ?? line.sourceWarehouseReceiptLineId ?? line.sourceInspectionId!;
      const usedQty = await computeSourceReturnedQty(tx, line.sourceRefType, sourceId);
      const availableQty = computeSourceAvailableQty(returnableQty, usedQty);
      if (line.quantity.gt(availableQty)) {
        return { error: 'OVER_SOURCE_BALANCE' as const };
      }
    }

    // ④ CAS 落定：id + version + status=DRAFT 原子条件；成功递增 version（幂等防并发双 Return）
    const returnedAt = new Date();
    const cas = await tx.purchaseReturn.updateMany({
      where: { id, version, status: 'DRAFT', deletedAt: null },
      data: {
        status: 'RETURNED',
        returnedAt,
        returnedById: actorId,
        updatedById: actorId,
        version: { increment: 1 },
      },
    });
    if (cas.count !== 1) {
      return { error: 'VERSION_CONFLICT' as const };
    }

    return {
      ok: true as const,
      purchaseReturnId: pr.id,
      purchaseReturnCode: pr.code,
      purchaseOrderId: pr.purchaseOrderId,
      supplierId: pr.supplierId,
      returnType: pr.returnType,
      disposition: lines[0]?.disposition ?? 'CREDIT_ONLY',
      returnedAt: returnedAt.toISOString(),
    };
  });

  if ('error' in result) {
    switch (result.error) {
      case 'NOT_FOUND':
        return failNotFound(ERROR_CODES.PURCHASE_RETURN_NOT_FOUND, '退货单不存在');
      case 'ALREADY_RETURNED':
        return failConflict(
          ERROR_CODES.PURCHASE_RETURN_ALREADY_RETURNED,
          '退货单已完成（RETURNED），禁止重复 Return（幂等）',
        );
      case 'INVALID_STATE':
        return failConflict(
          ERROR_CODES.PURCHASE_RETURN_INVALID_STATE,
          `仅 DRAFT 状态可完成退货（当前 ${result.status}）`,
        );
      case 'NO_LINES':
        return fail(ERROR_CODES.PURCHASE_RETURN_NO_LINES, '退货单没有行，无法完成退货', 400);
      case 'SOURCE_INVALID':
        return fail(ERROR_CODES.PURCHASE_RETURN_SOURCE_INVALID, '退货来源不存在或已删除', 409);
      case 'SOURCE_MISMATCH':
        return failConflict(
          ERROR_CODES.PURCHASE_RETURN_SOURCE_MISMATCH,
          '退货来源不属于该采购订单',
        );
      case 'SOURCE_NOT_RETURNABLE':
        return failConflict(
          ERROR_CODES.PURCHASE_RETURN_SOURCE_NOT_RETURNABLE,
          '来源不可退货（WAREHOUSE_RECEIPT_LINE 必须来自 POSTED 入库事实；INSPECTION 必须已完成）',
        );
      case 'OVER_SOURCE_BALANCE':
        return failConflict(
          ERROR_CODES.PURCHASE_RETURN_OVER_SOURCE_BALANCE,
          '退货数量超过来源可退余额（来源可退 - 累计 RETURNED；锁内重算防并发超退）',
        );
      case 'VERSION_CONFLICT':
        return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试（并发修改）');
      default:
        return failConflict(ERROR_CODES.CONFLICT, '完成退货失败');
    }
  }

  // ⑤ 事务成功提交后发布事件（规则⑧：只有 return 成功后发 PurchaseReturned；载荷对齐 EVENTS.md 2.3.9）
  try {
    await publishPurchaseReturnEvent({
      eventType: 'PurchaseReturned',
      actorId,
      entityId: result.purchaseReturnId,
      payload: {
        purchaseReturnId: result.purchaseReturnId,
        purchaseReturnCode: result.purchaseReturnCode,
        purchaseOrderId: result.purchaseOrderId,
        supplierId: result.supplierId,
        returnType: result.returnType,
        disposition: result.disposition,
        returnedById: actorId,
        returnedAt: result.returnedAt,
      },
      meta,
    });
  } catch {
    // 事件总线未落地（Known Risk）：发布失败不阻断业务事实（事务已提交）；生产前升级 Transactional Outbox（CTO #7045 债务记录）
  }

  // ⑥ 显式 AuditLog（Audit 与 Domain Event 分离，有 Event 不省 Audit——CTO #7115 Minor 教训沿用）
  await writeAuditLog({
    actorId,
    action: 'PurchaseReturned',
    entityType: 'purchase-return',
    entityId: result.purchaseReturnId,
    afterData: {
      purchaseReturnId: result.purchaseReturnId,
      purchaseReturnCode: result.purchaseReturnCode,
      purchaseOrderId: result.purchaseOrderId,
      supplierId: result.supplierId,
      returnType: result.returnType,
      disposition: result.disposition,
      returnedById: actorId,
      returnedAt: result.returnedAt,
    },
    meta,
  });

  return ok({
    id: result.purchaseReturnId,
    code: result.purchaseReturnCode,
    status: 'RETURNED',
    returnedAt: result.returnedAt,
  });
}
