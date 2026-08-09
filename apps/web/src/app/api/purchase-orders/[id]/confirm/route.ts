import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import {
  createPurchaseOrderRevision,
  createPurchaseOrderSnapshot,
} from '@/lib/purchase-order/helpers';
import { publishPurchaseOrderEvent } from '@/lib/purchase-order/events';

export const dynamic = 'force-dynamic';

/**
 * POST /api/purchase-orders/:id/confirm —— APPROVED → CONFIRMED（CTO Phase 4B，关键商业动作）
 * 红线（CTO Phase 4B 指令 + 拍板调整③）：
 *   - **APPROVED ≠ CONFIRMED**：Workflow 审批完成只回写 APPROVED 投影；只有显式 Confirm 才是
 *     "正式向供应商下单"；只有 CONFIRMED PO 才能成为 Sprint 5B Goods Receipt 唯一合法来源
 *   - 事务：Lock PO → 校验 status=APPROVED + approvalStatus=APPROVED（approval gate）→ Supplier →
 *     Lines（非空 + quantity>0）→ 金额一致性（服务端重算与 Header 一致）→ status=CONFIRMED +
 *     confirmedAt/confirmedById → **CONFIRMED Snapshot**（唯一约束 [purchaseOrderId, snapshotType, revisionNo]
 *     已放宽，Migration 0022）→ Revision（变更留痕）→ PurchaseOrderConfirmed Event + Audit
 *   - 5B 收货门禁（本阶段定义）：GR 只接受 CONFIRMED / PARTIALLY_RECEIVED PO；DRAFT/SUBMITTED/APPROVED/CANCELLED 拒绝
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // confirm 映射现有动作（对齐 quotation.convert 先例：confirm→:approve）
  const denied = requirePermission(user, 'purchase-order:approve');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-order.confirm');

  const { id } = await params;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const result = await prisma.$transaction(async (tx) => {
    // ① Lock PO（FOR UPDATE）
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      `SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: 'NOT_FOUND' as const };

    const po = await tx.purchaseOrder.findFirst({
      where: { id, deletedAt: null },
      include: {
        supplier: { select: { id: true, isActive: true } },
        lines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } },
      },
    });
    if (!po) return { error: 'NOT_FOUND' as const };

    // ② 状态门禁：仅 APPROVED 可 Confirm（APPROVED ≠ CONFIRMED）
    if (po.status !== 'APPROVED') {
      return { error: 'INVALID_STATE' as const, status: po.status };
    }
    // ③ approval gate：审批投影必须 APPROVED
    if (po.approvalStatus !== 'APPROVED') {
      return { error: 'APPROVAL_REQUIRED' as const };
    }
    // ④ Supplier / Lines / 金额一致性
    if (!po.supplier || po.supplier.isActive === false) {
      return { error: 'SUPPLIER_NOT_FOUND' as const };
    }
    if (po.lines.length === 0) {
      return { error: 'NO_LINES' as const };
    }
    const invalidQty = po.lines.some((l) => l.quantity.lte(0));
    if (invalidQty) {
      return { error: 'QUANTITY_INVALID' as const };
    }
    const subtotal = po.lines.reduce((s, l) => s.plus(l.lineAmount), new Prisma.Decimal(0));
    const taxAmount = po.lines.reduce((s, l) => s.plus(l.taxAmount), new Prisma.Decimal(0));
    const totalAmount = po.lines.reduce((s, l) => s.plus(l.totalAmount), new Prisma.Decimal(0));
    if (
      !subtotal.equals(po.subtotal) ||
      !taxAmount.equals(po.taxAmount) ||
      !totalAmount.equals(po.totalAmount)
    ) {
      return { error: 'AMOUNT_MISMATCH' as const };
    }

    // ⑤ APPROVED → CONFIRMED（正式下单投影）
    const confirmed = await tx.purchaseOrder.update({
      where: { id: po.id },
      data: {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        confirmedById: actorId,
        updatedById: actorId,
      },
    });

    // ⑥ CONFIRMED Snapshot（唯一约束 [purchaseOrderId, snapshotType, revisionNo]，Migration 0022）
    await createPurchaseOrderSnapshot(
      tx,
      po.id,
      'CONFIRMED',
      {
        status: 'CONFIRMED',
        sourceType: po.sourceType,
        supplierId: po.supplierId,
        supplierCode: po.supplier?.id,
        requisitionId: po.requisitionId,
        currency: po.currency,
        subtotal: po.subtotal.toString(),
        taxAmount: po.taxAmount.toString(),
        totalAmount: po.totalAmount.toString(),
        confirmedBy: actorId,
        confirmedAt: confirmed.confirmedAt?.toISOString(),
        lines: po.lines.map((l) => ({
          lineNo: l.lineNo,
          itemId: l.itemId,
          quantity: l.quantity.toString(),
          priceSource: l.priceSource,
          unitPrice: l.unitPrice.toString(),
          taxRate: l.taxRate.toString(),
          lineAmount: l.lineAmount.toString(),
          taxAmount: l.taxAmount.toString(),
          totalAmount: l.totalAmount.toString(),
        })),
      },
      actorId,
    );

    // ⑦ Revision（Confirm 动作留痕）
    await createPurchaseOrderRevision(
      tx,
      po.id,
      '确认正式下单（APPROVED → CONFIRMED）',
      {
        header: {
          code: po.code,
          sourceType: po.sourceType,
          supplierId: po.supplierId,
          requisitionId: po.requisitionId,
          status: 'APPROVED',
          currency: po.currency,
          paymentTerm: po.paymentTerm,
          totalAmount: po.totalAmount.toString(),
        },
        confirmedBy: actorId,
        confirmedAt: confirmed.confirmedAt?.toISOString(),
      },
      actorId,
    );

    return { po: confirmed, error: null as null };
  });

  if (result.error === 'NOT_FOUND') {
    return failNotFound(ERROR_CODES.PURCHASE_ORDER_NOT_FOUND, '采购订单不存在');
  }
  if (result.error === 'INVALID_STATE') {
    return failConflict(
      ERROR_CODES.PURCHASE_ORDER_INVALID_STATE,
      `仅 APPROVED 状态可确认（当前 status=${result.status}；APPROVED ≠ CONFIRMED）`,
    );
  }
  if (result.error === 'APPROVAL_REQUIRED') {
    return failConflict(ERROR_CODES.PURCHASE_ORDER_APPROVAL_REQUIRED, '审批未通过（approvalStatus 非 APPROVED），禁止确认');
  }
  if (result.error === 'SUPPLIER_NOT_FOUND') {
    return failConflict(ERROR_CODES.PURCHASE_ORDER_SUPPLIER_NOT_FOUND, '供应商无效');
  }
  if (result.error === 'NO_LINES') {
    return failConflict(ERROR_CODES.PURCHASE_ORDER_NO_LINES, '采购订单至少需要一行明细');
  }
  if (result.error === 'QUANTITY_INVALID') {
    return failConflict(ERROR_CODES.PURCHASE_ORDER_QUANTITY_INVALID, '采购数量必须大于 0');
  }
  if (result.error === 'AMOUNT_MISMATCH') {
    return failConflict(ERROR_CODES.PURCHASE_ORDER_INVALID_STATE, '金额与服务端聚合不一致，请刷新后重试');
  }
  if (!result.po) {
    return fail(ERROR_CODES.INTERNAL_ERROR, '确认采购订单失败', 500);
  }

  // ⑧ PurchaseOrderConfirmed Event + Audit（事务外，事件失败降级不阻断）
  await publishPurchaseOrderEvent({
    eventType: 'PurchaseOrderConfirmed',
    actorId,
    entityId: id,
    payload: {
      purchaseOrderId: id,
      purchaseOrderCode: result.po.code,
      sourceType: result.po.sourceType,
      supplierId: result.po.supplierId,
      requisitionId: result.po.requisitionId,
      currency: result.po.currency,
      totalAmount: result.po.totalAmount.toString(),
      confirmedBy: actorId,
      confirmedAt: result.po.confirmedAt?.toISOString(),
    },
    meta,
  }).catch(() => undefined);
  await writeAuditLog({
    actorId,
    action: 'purchase-order.confirm',
    entityType: 'purchase-order',
    entityId: id,
    afterData: {
      status: result.po.status,
      confirmedAt: result.po.confirmedAt?.toISOString(),
      totalAmount: result.po.totalAmount.toString(),
    },
    ...meta,
  });

  return ok({ id, status: 'CONFIRMED', confirmedAt: result.po.confirmedAt });
}
