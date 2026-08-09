import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import {
  createPurchaseOrderRevision,
  createPurchaseOrderSnapshot,
} from '@/lib/purchase-order/helpers';
import { publishPurchaseOrderEvent } from '@/lib/purchase-order/events';

export const dynamic = 'force-dynamic';

/**
 * POST /api/purchase-orders/:id/cancel —— Cancel（CTO Phase 4B Cancel 规则锁死）
 * - **DRAFT**：允许 Cancel（DRAFT → CANCELLED）
 * - **SUBMITTED**：不允许直接 Cancel（409）——按 CTO 规则：先 Withdraw Workflow（→ DRAFT），再 Cancel；
 *   或走驳回重提流程；不开放 SUBMITTED 直取消（避免绕过审批事实）
 * - **APPROVED**：允许 Cancel（未正式下单，未对供应商形成外部承诺）
 * - **CONFIRMED / PARTIALLY_RECEIVED / RECEIVED**：禁止 Cancel（409 PURCHASE_ORDER_CANCEL_FORBIDDEN）——
 *   已形成外部采购承诺；后续应走 Close / Purchase Amendment / Purchase Cancellation / Supplier communication
 * - 事务：Lock PO → 状态门禁 → status=CANCELLED + cancelledAt/cancelledById（投影字段，Schema 0021 已有）
 *   → CANCELLED Snapshot（唯一约束 [purchaseOrderId, snapshotType, revisionNo]，Migration 0022）→ Revision →
 *   PurchaseOrderCancelled Event + Audit
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // cancel 映射现有动作（对齐 quotation.cancel 先例：cancel→:close）
  const denied = requirePermission(user, 'purchase-order:close');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-order.cancel');

  const { id } = await params;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const result = await prisma.$transaction(async (tx) => {
    // ① Lock PO（FOR UPDATE）
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: 'NOT_FOUND' as const };

    const po = await tx.purchaseOrder.findFirst({
      where: { id, deletedAt: null },
      include: { lines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } } },
    });
    if (!po) return { error: 'NOT_FOUND' as const };

    // ② 状态门禁（CTO Phase 4B Cancel 规则）
    switch (po.status) {
      case 'DRAFT':
      case 'APPROVED':
        break; // 允许 Cancel
      case 'SUBMITTED':
        // CTO：SUBMITTED 建议先 Withdraw Workflow 再 Cancel，或不开放直接 Cancel（只允许 Withdraw → DRAFT → Cancel）
        return { error: 'SUBMITTED_FORBIDDEN' as const };
      case 'CONFIRMED':
      case 'PARTIALLY_RECEIVED':
      case 'RECEIVED':
        // 已形成外部采购承诺，禁止 Cancel
        return { error: 'CANCEL_FORBIDDEN' as const, status: po.status };
      case 'CANCELLED':
        return { error: 'ALREADY_CANCELLED' as const };
      default:
        return { error: 'INVALID_STATE' as const, status: po.status };
    }

    // ③ DRAFT/APPROVED → CANCELLED
    const cancelled = await tx.purchaseOrder.update({
      where: { id: po.id },
      data: {
        status: 'CANCELLED',
        updatedById: actorId,
      },
    });

    // ④ CANCELLED Snapshot + Revision
    await createPurchaseOrderSnapshot(
      tx,
      po.id,
      'CANCELLED',
      {
        status: 'CANCELLED',
        sourceType: po.sourceType,
        supplierId: po.supplierId,
        requisitionId: po.requisitionId,
        currency: po.currency,
        subtotal: po.subtotal.toString(),
        taxAmount: po.taxAmount.toString(),
        totalAmount: po.totalAmount.toString(),
        cancelledBy: actorId,
        cancelledAt: new Date().toISOString(),
      },
      actorId,
    );
    await createPurchaseOrderRevision(
      tx,
      po.id,
      '取消采购订单',
      {
        header: {
          code: po.code,
          sourceType: po.sourceType,
          supplierId: po.supplierId,
          requisitionId: po.requisitionId,
          status: po.status,
          currency: po.currency,
          totalAmount: po.totalAmount.toString(),
        },
        cancelledBy: actorId,
        cancelledAt: new Date().toISOString(),
      },
      actorId,
    );

    return { po: cancelled, error: null as null };
  });

  if (result.error === 'NOT_FOUND') {
    return failNotFound(ERROR_CODES.PURCHASE_ORDER_NOT_FOUND, '采购订单不存在');
  }
  if (result.error === 'SUBMITTED_FORBIDDEN') {
    return failConflict(
      ERROR_CODES.PURCHASE_ORDER_INVALID_STATE,
      'SUBMITTED 状态不允许直接取消：请先撤回审批（Withdraw → DRAFT）再取消',
    );
  }
  if (result.error === 'CANCEL_FORBIDDEN') {
    return failConflict(
      ERROR_CODES.PURCHASE_ORDER_CANCEL_FORBIDDEN,
      `CONFIRMED 及以上状态禁止取消（当前 status=${result.status}）：已形成外部采购承诺，后续应走 Close / Purchase Amendment / Supplier communication`,
    );
  }
  if (result.error === 'ALREADY_CANCELLED') {
    return failConflict(ERROR_CODES.PURCHASE_ORDER_INVALID_STATE, '采购订单已取消');
  }
  if (result.error === 'INVALID_STATE') {
    return failConflict(
      ERROR_CODES.PURCHASE_ORDER_INVALID_STATE,
      `当前状态不可取消（status=${result.status}）`,
    );
  }
  if (!result.po) {
    return fail(ERROR_CODES.INTERNAL_ERROR, '取消采购订单失败', 500);
  }

  // ⑤ PurchaseOrderCancelled Event + Audit（事务外，事件失败降级不阻断）
  await publishPurchaseOrderEvent({
    eventType: 'PurchaseOrderCancelled',
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
      cancelledBy: actorId,
      cancelledAt: new Date().toISOString(),
    },
    meta,
  }).catch(() => undefined);
  await writeAuditLog({
    actorId,
    action: 'purchase-order.cancel',
    entityType: 'purchase-order',
    entityId: id,
    afterData: { status: result.po.status, totalAmount: result.po.totalAmount.toString() },
    ...meta,
  });

  return ok({ id, status: 'CANCELLED' });
}
