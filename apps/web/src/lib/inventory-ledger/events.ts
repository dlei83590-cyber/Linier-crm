import { writeAuditLog } from '@/lib/api-helpers';

/**
 * Sprint 6A - Inventory Ledger Domain Events 发布（EVENTS.md v1.26 已注册 InventoryMovementCommitted）
 * 事件总线尚未落地（Known Risk），当前以 AuditLog 留痕；总线落地后替换为 publish。
 * 本阶段（Inventory Consumer）已实现：`InventoryMovementCommitted`——**只有 Consumer 单事务（Movement +
 * StockProjection + Outbox PROCESSED）成功提交后才发布**（CTO #7588 canonical 流程最后一步）。
 * 红线：载荷含库存流水落定事实（movementId/movementNo/五元来源/方向/五维/数量/生效时间）；
 * **本事件不含投影余额**（P10 Final：暂不发布 StockProjectionChanged——避免把 projection 变成业务事实）。
 */

export interface InventoryMovementCommittedPayload {
  movementId: string;
  movementNo: string;
  sourceType: 'WAREHOUSE_RECEIPT_POSTED' | 'PURCHASE_RETURN_RETURNED' | 'REVERSAL' | 'CORRECTION';
  sourceId: string;
  sourceLineId: string;
  movementRole: 'IN' | 'OUT' | 'SOURCE_OUT' | 'DESTINATION_IN' | 'CONSUME' | 'PRODUCE' | 'ADJUSTMENT' | 'REVERSAL' | 'CORRECTION';
  movementAtomKey: string;
  direction: 'IN' | 'OUT';
  warehouseId: string;
  locationId?: string | null;
  itemId: string;
  batchNo?: string | null;
  serialNo?: string | null;
  quantity: string; // Decimal 字符串（防精度丢失）
  committedAt: string; // ISO
  [key: string]: unknown;
}

export async function publishInventoryMovementCommitted(params: {
  eventType: 'InventoryMovementCommitted';
  actorId?: string | null;
  entityId: string;
  payload: InventoryMovementCommittedPayload;
  meta?: object;
}) {
  await writeAuditLog({
    actorId: params.actorId ?? null,
    action: params.eventType,
    entityType: 'inventory-movement',
    entityId: params.entityId,
    afterData: params.payload,
    meta: params.meta,
  });
}
