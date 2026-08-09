import { writeAuditLog } from '@/lib/api-helpers';

/** Sprint 5B - WarehouseReceipt Domain Events 发布（EVENTS.md v2.3.9 已注册 WarehouseReceiptPosted）
 * 事件总线尚未落地（Known Risk），当前以 AuditLog 留痕；总线落地后替换为 publish。
 * 本阶段（WarehouseReceipt API）已实现：WarehouseReceiptPosted（**只有 POST 事务成功后发布**——D10：Created ≠ Posted，
 * 只有 Posted 才触发 6A InventoryMovement(IN)；DRAFT 创建/编辑不发领域事件）。
 * 红线：载荷含业务动作事实（入库单/来源收货/仓库库位/操作人/时间）；**本事件不含库存余额**——
 * Stock/InventoryMovement 属 6A 唯一事实源，5B 永不直接写库存；InventoryMovement(IN) 由 6A 在消费本事件后生成。
 */

export interface WarehouseReceiptEventPayload {
  warehouseReceiptId: string;
  warehouseReceiptCode: string;
  purchaseReceiptId: string;
  warehouseId: string;
  locationId?: string | null;
  postedById: string;
  postedAt: string;
  [key: string]: unknown;
}

export async function publishWarehouseReceiptEvent(params: {
  eventType: 'WarehouseReceiptPosted';
  actorId?: string | null;
  entityId: string;
  payload: WarehouseReceiptEventPayload;
  meta?: object;
}) {
  await writeAuditLog({
    actorId: params.actorId ?? null,
    action: params.eventType,
    entityType: 'warehouse-receipt',
    entityId: params.entityId,
    afterData: params.payload,
    meta: params.meta,
  });
}
