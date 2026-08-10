import { writeAuditLog } from '@/lib/api-helpers';

/** Sprint 5B - Inspection Domain Events 发布（EVENTS.md v2.3.9 已注册 InspectionCompleted）
 * 事件总线尚未落地（Known Risk），当前以 AuditLog 留痕；总线落地后替换为 publish。
 * 本阶段（Inspection API）已实现：InspectionCompleted（**只有 complete 事务成功后发布**——对齐 CTO #6923 规则⑧：
 * 事件后发；PENDING 创建/编辑不发领域事件）。
 * 红线：载荷含业务动作事实（检验行/模式/结论/数量/操作人/时间）；**Inspection 事件不含库存余额**
 * （Stock/InventoryMovement 属 6A；D10：只有 WarehouseReceipt Posted 才触发 6A InventoryMovement(IN)）。
 */

export interface InspectionEventPayload {
  inspectionId: string;
  purchaseReceiptLineId: string;
  inspectionMode: 'SKIP' | 'SPOT' | 'FULL';
  result: 'QUALIFIED' | 'PARTIAL' | 'REJECTED';
  qualifiedQty: unknown;
  rejectedQty: unknown;
  inspectedById: string;
  inspectedAt: string;
  [key: string]: unknown;
}

export async function publishInspectionEvent(params: {
  eventType: 'InspectionCompleted';
  actorId?: string | null;
  entityId: string;
  payload: InspectionEventPayload;
  meta?: object;
}) {
  await writeAuditLog({
    actorId: params.actorId ?? null,
    action: params.eventType,
    entityType: 'inspection',
    entityId: params.entityId,
    afterData: params.payload,
    meta: params.meta,
  });
}
