import { writeAuditLog } from '@/lib/api-helpers';

/** Sprint 5A - PurchaseOrder Domain Events 发布（EVENTS.md v2.3.8 已注册 PO 事件）
 * 事件总线尚未落地（Known Risk），当前以 AuditLog 留痕；总线落地后替换为 publish。
 * 本阶段（Phase 4A）已实现：PurchaseOrderCreated（Convert/Direct 创建时发布）。
 * Phase 4B 实现：Submitted / ApprovalStarted / Approved / Rejected / Confirmed / Cancelled。
 * 红线（CTO Design Review 拍板③/调整③）：载荷含金额事实（PO = 采购承诺事实源）；
 * sourceType=REQUISITION|DIRECT；**APPROVED ≠ CONFIRMED**（PurchaseOrderConfirmed 只有显式 confirm 才发布）。
 */

export interface PurchaseOrderEventPayload {
  purchaseOrderId: string;
  purchaseOrderCode: string;
  sourceType?: string | null;
  supplierId: string;
  requisitionId?: string | null;
  currency: string;
  totalAmount: unknown;
  [key: string]: unknown;
}

export async function publishPurchaseOrderEvent(params: {
  eventType: string;
  actorId?: string | null;
  entityId: string;
  payload: PurchaseOrderEventPayload;
  meta?: object;
}) {
  await writeAuditLog({
    actorId: params.actorId ?? null,
    action: params.eventType,
    entityType: 'purchase-order',
    entityId: params.entityId,
    afterData: params.payload,
    meta: params.meta,
  });
}
