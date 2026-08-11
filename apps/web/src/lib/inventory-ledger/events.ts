import { writeAuditLog } from '@/lib/api-helpers';
import type { InventoryMovementRole, InventoryMovementSourceType } from '@prisma/client';

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
  sourceType: InventoryMovementSourceType; // 6B 扩展后含 TRANSFER/ADJUSTMENT/CONVERSION（对齐 schema 枚举，事件契约同步）
  sourceId: string;
  sourceLineId: string;
  movementRole: InventoryMovementRole;
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
