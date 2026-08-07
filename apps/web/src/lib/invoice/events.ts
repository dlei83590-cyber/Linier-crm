import { writeAuditLog } from "@/lib/api-helpers";

/** Sprint 4D - Invoice Domain Events 发布（EVENTS.md v1.7 已注册 5 个 Invoice 事件）
 * 事件总线尚未落地（Known Risk），当前以 AuditLog 留痕；总线落地后替换为 publish。
 * 已实现：InvoiceCreated / InvoiceIssued / InvoiceCancelled（4D）；PartiallyPaid / Paid 待 4E（先注册后实现）。
 */

export interface InvoiceEventPayload {
  invoiceId: string;
  invoiceCode?: string | null;
  deliveryId: string;
  salesOrderId: string;
  customerId: string;
  currency: string;
  invoiceTotal: unknown;
  [key: string]: unknown;
}

export async function publishInvoiceEvent(params: {
  eventType: string;
  actorId?: string | null;
  entityId: string;
  payload: InvoiceEventPayload;
  meta?: object;
}) {
  await writeAuditLog({
    actorId: params.actorId ?? null,
    action: params.eventType,
    entityType: "invoice",
    entityId: params.entityId,
    afterData: params.payload,
    meta: params.meta,
  });
}
