import { writeAuditLog } from '@/lib/api-helpers';

/** Sprint 6B-3 - InventoryAdjustment Domain Events 发布（EVENTS.md v1.28 已注册 InventoryAdjustmentApplied）
 * 事件总线尚未落地（Known Risk），当前以 AuditLog 留痕；总线落地后替换为 publish。
 * `InventoryAdjustmentApplied`——**只有 Apply 事务成功（单据 APPLIED + ADJUSTMENT Movement 同事务提交）后才发布**。
 * 红线：载荷含调整执行事实（adjustmentId/adjustmentNo/reasonCode/sourceStockCountId/lines[含行级 direction]/
 * appliedById/appliedAt），**不含库存余额**（6A 唯一事实源）；DRAFT 创建/编辑/提交/取消不发领域事件（仅 AuditLog）。
 */

export interface InventoryAdjustmentEventPayload {
  adjustmentId: string;
  adjustmentNo: string;
  reasonCode: string;
  sourceStockCountId?: string | null;
  lines: Array<{
    lineId: string;
    direction: 'IN' | 'OUT';
    warehouseId: string;
    locationId?: string | null;
    itemId: string;
    batchNo?: string | null;
    serialNo?: string | null;
    quantity: string; // Decimal 字符串（防精度丢失）
    sourceStockCountLineId?: string | null;
  }>;
  appliedById: string;
  appliedAt: string; // ISO
  [key: string]: unknown;
}

export async function publishInventoryAdjustmentEvent(params: {
  eventType: 'InventoryAdjustmentApplied';
  actorId?: string | null;
  entityId: string;
  payload: InventoryAdjustmentEventPayload;
  meta?: object;
}) {
  await writeAuditLog({
    actorId: params.actorId ?? null,
    action: params.eventType,
    entityType: 'inventory-adjustment',
    entityId: params.entityId,
    afterData: params.payload,
    meta: params.meta,
  });
}
