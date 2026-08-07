import { writeAuditLog } from "@/lib/api-helpers";

/** Sprint 4A - Quotation Domain Events 发布（EVENTS.md v1.2 已注册 11 个 Quotation 事件）
 * 事件总线尚未落地（Known Risk），当前以 AuditLog 留痕；总线落地后替换为 publish。
 */

export interface QuotationEventPayload {
  quotationId: string;
  quotationCode: string;
  revisionNo?: number;
  customerId: string;
  projectId?: string | null;
  workflowInstanceId?: string | null;
  currency: string;
  totalAmount: unknown;
  [key: string]: unknown;
}

export async function publishQuotationEvent(params: {
  eventType: string;
  actorId?: string | null;
  entityId: string;
  payload: QuotationEventPayload;
  meta?: object;
}) {
  await writeAuditLog({
    actorId: params.actorId ?? null,
    action: params.eventType,
    entityType: "quotation",
    entityId: params.entityId,
    afterData: params.payload,
    meta: params.meta,
  });
}
