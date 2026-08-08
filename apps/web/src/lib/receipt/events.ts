import { writeAuditLog } from "@/lib/api-helpers";

/** Sprint 4E-2 - Receipt Domain Events 发布（EVENTS.md v1.10 已注册 11 个收款/核销事件）
 * 事件总线尚未落地（Known Risk），当前以 AuditLog 留痕；总线落地后替换为 publish。
 * 已实现：ReceiptCreated（4E-2 Phase 2）；ReceiptUpdated/Allocated/FullyAllocated/AllocationReversed/Voided + WriteOff* 后续阶段实现。
 */

export interface ReceiptEventPayload {
  receiptId: string;
  receiptCode?: string | null;
  customerId: string;
  currency: string;
  amount: unknown;
  allocatedAmount?: unknown;
  unallocatedAmount?: unknown;
  [key: string]: unknown;
}

export async function publishReceiptEvent(params: {
  eventType: string;
  actorId?: string | null;
  entityId: string;
  payload: ReceiptEventPayload;
  meta?: object;
}) {
  await writeAuditLog({
    actorId: params.actorId ?? null,
    action: params.eventType,
    entityType: "receipt",
    entityId: params.entityId,
    afterData: params.payload,
    meta: params.meta,
  });
}
