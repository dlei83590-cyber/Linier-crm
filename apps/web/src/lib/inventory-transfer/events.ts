import { writeAuditLog } from '@/lib/api-helpers';

/** Sprint 6B - InventoryTransfer Domain Events 发布（EVENTS.md v1.28 已注册 InventoryTransferExecuted）
 * 事件总线尚未落地（Known Risk），当前以 AuditLog 留痕；总线落地后替换为 publish。
 * 本阶段（Transfer Vertical Slice）已实现：`InventoryTransferExecuted`——**只有 EXECUTE 事务成功
 * （单据 EXECUTED + SOURCE_OUT + DESTINATION_IN Movement + 两侧 Projection 同事务提交）后才发布**。
 * 红线：载荷含调拨执行事实（transferId/transferNo/movementGroupId/源目标仓库位/lines/执行人/时间）；
 * **不含库存余额**（6A 唯一事实源）；DRAFT 创建/编辑/提交/取消不发领域事件（仅 AuditLog）。
 */

export interface InventoryTransferEventPayload {
  transferId: string;
  transferNo: string;
  movementGroupId: string;
  sourceWarehouseId: string;
  sourceLocationId?: string | null;
  destinationWarehouseId: string;
  destinationLocationId?: string | null;
  lines: Array<{
    lineId: string;
    itemId: string;
    quantity: string; // Decimal 字符串（防精度丢失）
    batchNo?: string | null;
  }>;
  executedById: string;
  executedAt: string; // ISO
  [key: string]: unknown;
}

export async function publishInventoryTransferEvent(params: {
  eventType: 'InventoryTransferExecuted';
  actorId?: string | null;
  entityId: string;
  payload: InventoryTransferEventPayload;
  meta?: object;
}) {
  await writeAuditLog({
    actorId: params.actorId ?? null,
    action: params.eventType,
    entityType: 'inventory-transfer',
    entityId: params.entityId,
    afterData: params.payload,
    meta: params.meta,
  });
}
