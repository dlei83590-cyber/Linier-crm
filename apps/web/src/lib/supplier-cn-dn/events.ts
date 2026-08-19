import { writeAuditLog } from '@/lib/api-helpers';
import { Prisma } from '@prisma/client';
import { writeDomainEvent } from '@/lib/domain-events/writer';

/**
 * Sprint 5C-2 - Supplier CN/DN Domain Events 发布（EVENTS.md v1.34 注册）
 * 事件总线尚未落地（Known Risk），当前以 AuditLog 留痕；总线落地后替换为 publish。
 * - `SupplierCreditDebitNoteApplied`：只有 APPLY 事务成功（status→APPLIED + ApOpenItem.openAmount 投影
 *   重算同事务提交）后才发布；载荷含 noteType/code/adjustmentTotal（signed）/openAmountAfter；
 *   **不含未投影的可变状态**（openAmount 为投影，增量下发 openAmountAfter 供消费方参考）。
 * 红线：5C-2 Payment 事件（SupplierPaymentApplied）属 Batch 2，本文件不发布。
 */

export interface SupplierCnDnEventPayload {
  cnDnId: string;
  code: string;
  noteType: string; // CREDIT | DEBIT
  supplierId: string;
  sourceSupplierInvoiceId: string;
  adjustmentTotal: string; // Decimal 字符串（CREDIT 负向 / DEBIT 正向 signed）
  openAmountAfter?: string; // ApOpenItem.openAmount 投影（apply 后）
  appliedById?: string;
  appliedAt?: string; // ISO
  [key: string]: unknown;
}

/** 事务内原子写 Outbox（事件总线落地；幂等键 SupplierCreditDebitNoteApplied|cnDnId） */
export async function writeSupplierCnDnAppliedEvent(
  tx: Prisma.TransactionClient,
  params: { cnDnId: string; payload: SupplierCnDnEventPayload },
) {
  await writeDomainEvent(tx, {
    eventType: 'SupplierCreditDebitNoteApplied',
    aggregateType: 'SupplierCreditDebitNote',
    aggregateId: params.cnDnId,
    payload: params.payload,
    idempotencyKey: `SupplierCreditDebitNoteApplied|${params.cnDnId}`,
  });
}

export async function publishSupplierCnDnEvent(params: {
  eventType: 'SupplierCreditDebitNoteApplied';
  actorId?: string | null;
  entityId: string;
  payload: SupplierCnDnEventPayload;
  meta?: object;
}) {
  await writeAuditLog({
    actorId: params.actorId ?? null,
    action: params.eventType,
    entityType: 'supplier-credit-debit-note',
    entityId: params.entityId,
    afterData: params.payload,
    meta: params.meta,
  });
}