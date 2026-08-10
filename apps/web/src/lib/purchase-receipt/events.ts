import { writeAuditLog } from '@/lib/api-helpers';

/** Sprint 5B - PurchaseReceipt Domain Events 发布（EVENTS.md v2.3.9 已注册 5B 事件）
 * 事件总线尚未落地（Known Risk），当前以 AuditLog 留痕；总线落地后替换为 publish。
 * 本阶段（PurchaseReceipt API）已实现：PurchaseReceiptReceived（**只有 Receive 事务成功后发布**——CTO #6923 规则⑧，
 * DRAFT 创建不发事件）+ PO 收货聚合投影事件（PurchaseOrderPartiallyReceived / PurchaseOrderReceived）。
 * 红线：载荷含业务动作事实（PO/收货/数量/操作人）；**5B 事件不含库存余额**（Stock/InventoryMovement 属 6A）。
 */

export interface PurchaseReceiptEventPayload {
  purchaseReceiptId: string;
  purchaseReceiptCode: string;
  purchaseOrderId: string;
  supplierId: string;
  warehouseId?: string | null;
  receivedById: string;
  receivedAt: string;
  [key: string]: unknown;
}

/** PO 收货聚合投影事件载荷（ADR-0023 已预留；EVENTS.md 2.3.9 注册） */
export interface PurchaseOrderReceiptProjectionPayload {
  purchaseOrderId: string;
  purchaseOrderCode: string;
  supplierId: string;
  receivedQty: unknown;
  remainingReceiveQty?: unknown;
  [key: string]: unknown;
}

export async function publishPurchaseReceiptEvent(params: {
  eventType: string;
  actorId?: string | null;
  entityId: string;
  payload: PurchaseReceiptEventPayload;
  meta?: object;
}) {
  await writeAuditLog({
    actorId: params.actorId ?? null,
    action: params.eventType,
    entityType: 'purchase-receipt',
    entityId: params.entityId,
    afterData: params.payload,
    meta: params.meta,
  });
}

export async function publishPurchaseOrderReceiptProjectionEvent(params: {
  eventType: 'PurchaseOrderPartiallyReceived' | 'PurchaseOrderReceived';
  actorId?: string | null;
  entityId: string;
  payload: PurchaseOrderReceiptProjectionPayload;
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
