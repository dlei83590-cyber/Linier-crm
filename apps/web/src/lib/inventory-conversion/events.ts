import { writeAuditLog } from '@/lib/api-helpers';

/** Sprint 6B-4 - InventoryConversion Domain Events 发布（EVENTS.md v1.28 已注册 InventoryConversionExecuted）
 * 事件总线尚未落地（Known Risk），当前以 AuditLog 留痕；总线落地后替换为 publish。
 * `InventoryConversionExecuted`——**只有 Execute 事务成功（单据 EXECUTED + CONSUME + PRODUCE Movement 同事务提交）后才发布**。
 * 红线：载荷含转换执行事实（conversionId/conversionNo/itemId/baseUomId/movementGroupId/lines[行级
 * uomToBaseRate + canonical baseQuantity]/executedById/executedAt），**不含库存余额**（6A 唯一事实源）；
 * DRAFT 创建/编辑/提交/取消不发领域事件（仅 AuditLog）。
 */

export interface InventoryConversionEventPayload {
  conversionId: string;
  conversionNo: string;
  itemId: string;
  baseUomId: string;
  movementGroupId: string;
  lines: Array<{
    lineId: string;
    lineRole: 'CONSUME' | 'PRODUCE';
    quantity: string; // Decimal 字符串（防精度丢失）
    uomId?: string | null;
    uomToBaseRate: string; // Decimal 字符串（行级换算率 snapshot）
    baseQuantity: string; // Decimal 字符串（canonical 数量 = quantity × uomToBaseRate）
    warehouseId: string;
    locationId?: string | null;
    batchNo?: string | null;
  }>;
  executedById: string;
  executedAt: string; // ISO
  [key: string]: unknown;
}

export async function publishInventoryConversionEvent(params: {
  eventType: 'InventoryConversionExecuted';
  actorId?: string | null;
  entityId: string;
  payload: InventoryConversionEventPayload;
  meta?: object;
}) {
  await writeAuditLog({
    actorId: params.actorId ?? null,
    action: params.eventType,
    entityType: 'inventory-conversion',
    entityId: params.entityId,
    afterData: params.payload,
    meta: params.meta,
  });
}
