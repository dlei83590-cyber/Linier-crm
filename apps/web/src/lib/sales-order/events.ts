import { writeAuditLog } from "@/lib/api-helpers";

/** Sprint 4B - Sales Order Domain Events 发布（EVENTS.md v1.4 已注册 7 个 SalesOrder 事件）
 * 事件总线尚未落地（Known Risk），当前以 AuditLog 留痕；总线落地后替换为 publish。
 */

export interface SalesOrderEventPayload {
  salesOrderId: string;
  salesOrderCode: string;
  quotationId?: string | null;
  customerId: string;
  projectId?: string | null;
  currency: string;
  totalAmount: unknown;
  [key: string]: unknown;
}

export async function publishSalesOrderEvent(params: {
  eventType: string;
  actorId?: string | null;
  entityId: string;
  payload: SalesOrderEventPayload;
  meta?: object;
}) {
  await writeAuditLog({
    actorId: params.actorId ?? null,
    action: params.eventType,
    entityType: "salesOrder",
    entityId: params.entityId,
    afterData: params.payload,
    meta: params.meta,
  });
}
