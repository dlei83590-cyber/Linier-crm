import { writeAuditLog } from '@/lib/api-helpers';

/** Sprint 5B - PurchaseReturn Domain Events 发布（EVENTS.md v2.3.9 已注册 PurchaseReturned）
 * 事件总线尚未落地（Known Risk），当前以 AuditLog 留痕；总线落地后替换为 publish。
 * 本阶段（PurchaseReturn API）已实现：PurchaseReturned（**只有 return 事务成功后发布**——对齐规则⑧事件纪律；
 * DRAFT 创建/编辑不发领域事件）。
 * 红线：载荷含业务动作事实（退货单/来源 PO/供应商/类型/处置/操作人/时间）；**本事件不含库存余额**——
 * Stock/InventoryMovement 属 6A 唯一事实源；已入库退货（WAREHOUSE_RECEIPT_LINE 来源）本阶段也只记录
 * PurchaseReturn 事实，**不写 InventoryMovement(OUT)**；财务冲减/红字发票/AP 属 5C。
 */

export interface PurchaseReturnEventPayload {
  purchaseReturnId: string;
  purchaseReturnCode: string;
  purchaseOrderId: string;
  supplierId: string;
  returnType: 'REJECTED_ON_RECEIPT' | 'RETURN_AFTER_STOCK_IN' | 'QUALITY_ISSUE';
  disposition: 'REPLACE_REQUIRED' | 'CREDIT_ONLY';
  returnedById: string;
  returnedAt: string;
  [key: string]: unknown;
}

export async function publishPurchaseReturnEvent(params: {
  eventType: 'PurchaseReturned';
  actorId?: string | null;
  entityId: string;
  payload: PurchaseReturnEventPayload;
  meta?: object;
}) {
  await writeAuditLog({
    actorId: params.actorId ?? null,
    action: params.eventType,
    entityType: 'purchase-return',
    entityId: params.entityId,
    afterData: params.payload,
    meta: params.meta,
  });
}
