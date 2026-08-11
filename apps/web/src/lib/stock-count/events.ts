import { writeAuditLog } from '@/lib/api-helpers';

/** Sprint 6B-3 - StockCount Domain Events 发布（EVENTS.md v1.28 已注册 InventoryCountCompleted）
 * 事件总线尚未落地（Known Risk），当前以 AuditLog 留痕；总线落地后替换为 publish。
 * `InventoryCountCompleted`——**只有 complete 事务成功（Count 锁定 + 差异 Adjustment 生成）后才发布**。
 * 红线：Count 本身不产生 Movement（载荷**不含库存余额**）；差异经 Adjustment Command 落账；
 * 载荷含盘点实盘事实（countId/countNo/freezeStrategy/lines[countedQty/bookQtyAtCount/varianceQty]/countedById/completedAt）。
 */

export interface StockCountEventPayload {
  countId: string;
  countNo: string;
  freezeStrategy: string;
  lines: Array<{
    lineId: string;
    warehouseId: string;
    locationId?: string | null;
    itemId: string;
    batchNo?: string | null;
    serialNo?: string | null;
    countedQty: string; // Decimal 字符串（防精度丢失）
    bookQtyAtCount: string; // Decimal 字符串
    varianceQty: string; // Decimal 字符串（countedQty - bookQtyAtCount）
  }>;
  countedById: string;
  completedAt: string; // ISO
  [key: string]: unknown;
}

export async function publishStockCountEvent(params: {
  eventType: 'InventoryCountCompleted';
  actorId?: string | null;
  entityId: string;
  payload: StockCountEventPayload;
  meta?: object;
}) {
  await writeAuditLog({
    actorId: params.actorId ?? null,
    action: params.eventType,
    entityType: 'stock-count',
    entityId: params.entityId,
    afterData: params.payload,
    meta: params.meta,
  });
}
