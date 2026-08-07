import { writeAuditLog } from "@/lib/api-helpers";

/** Sprint 4C - Delivery Domain Events 发布（EVENTS.md v1.5 已注册 8 个 Delivery 事件）
 * 事件总线尚未落地（Known Risk），当前以 AuditLog 留痕；总线落地后替换为 publish。
 */

export interface DeliveryEventPayload {
  deliveryId: string;
  deliveryCode: string;
  salesOrderId: string;
  customerId: string;
  [key: string]: unknown;
}

export async function publishDeliveryEvent(params: {
  eventType: string;
  actorId?: string | null;
  entityId: string;
  payload: DeliveryEventPayload;
  meta?: object;
}) {
  await writeAuditLog({
    actorId: params.actorId ?? null,
    action: params.eventType,
    entityType: "delivery",
    entityId: params.entityId,
    afterData: params.payload,
    meta: params.meta,
  });
}
