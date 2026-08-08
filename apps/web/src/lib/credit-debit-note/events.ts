import { writeAuditLog } from "@/lib/api-helpers";

/** Sprint 4E-3 - CreditDebitNote Domain Events 发布（EVENTS.md v1.12 已注册 2.3.7 发票调整领域事件）
 * 事件总线尚未落地（Known Risk），当前以 AuditLog 留痕；总线落地后替换为 publish。
 * 覆盖事件（EVENTS.md v1.12）：CreditDebitNoteCreated / CreditDebitNoteSubmitted /
 * CreditDebitNoteApprovalStarted / CreditDebitNoteApproved / CreditDebitNoteRejected
 * （Apply 阶段另发 InvoiceAdjustmentApplied + AccountsReceivableAdjusted——本文件 Phase 3 先不实现）。
 * **降级边界（CTO 明确）**：事件发布失败可降级（.catch），但 **CreditDebitNote 数据库事实更新
 * 不能因为 .catch() 被静默吞掉**——事件与主事务分离，主事务失败整体回滚。
 */

export interface CreditDebitNoteEventPayload {
  noteId: string;
  noteCode?: string | null;
  noteType: "CREDIT" | "DEBIT";
  sourceInvoiceId: string;
  customerId: string;
  currency: string;
  adjustmentTotal: unknown;
  reason?: string | null;
  workflowInstanceId?: string | null;
  [key: string]: unknown;
}

export async function publishCreditDebitNoteEvent(params: {
  eventType: string;
  actorId?: string | null;
  entityId: string;
  payload: CreditDebitNoteEventPayload;
  meta?: object;
}) {
  await writeAuditLog({
    actorId: params.actorId ?? null,
    action: params.eventType,
    entityType: "credit-debit-note",
    entityId: params.entityId,
    afterData: params.payload,
    meta: params.meta,
  });
}
