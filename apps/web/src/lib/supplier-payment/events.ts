import { writeAuditLog } from '@/lib/api-helpers';
import { Prisma } from '@prisma/client';
import { writeDomainEvent } from '@/lib/domain-events/writer';

/**
 * Sprint 5C-2 - Supplier Payment Domain Events 发布（EVENTS.md v1.34 注册）
 * `SupplierPaymentApplied`：只有 APPLY 事务成功（核销行 + payment 投影 + ApOpenItem.openAmount 投影同事务提交）后才发布。
 * 载荷含 paymentId/code/supplierId/apOpenItemId/allocatedAmount/openAmountAfter/unallocatedAmountAfter。
 */

export interface SupplierPaymentEventPayload {
  paymentId: string;
  code: string;
  supplierId: string;
  apOpenItemId: string;
  allocatedAmount: string;
  openAmountAfter?: string;
  unallocatedAmountAfter?: string;
  allocatedById?: string;
  allocatedAt?: string; // ISO
  [key: string]: unknown;
}

/** 事务内原子写 Outbox（事件总线落地；幂等键 SupplierPaymentApplied|paymentId|apOpenItemId） */
export async function writeSupplierPaymentAppliedEvent(
  tx: Prisma.TransactionClient,
  params: { paymentId: string; apOpenItemId: string; payload: SupplierPaymentEventPayload },
) {
  await writeDomainEvent(tx, {
    eventType: 'SupplierPaymentApplied',
    aggregateType: 'SupplierPayment',
    aggregateId: params.paymentId,
    payload: params.payload,
    idempotencyKey: `SupplierPaymentApplied|${params.paymentId}|${params.apOpenItemId}`,
  });
}

export interface SupplierPaymentReversedEventPayload {
  paymentId: string;
  code: string;
  supplierId: string;
  reversedAllocations: number;
  reversedById?: string;
  reversedAt?: string; // ISO
  [key: string]: unknown;
}

/** 事务内原子写 Outbox（SupplierPaymentReversed；幂等键 SupplierPaymentReversed|paymentId） */
export async function writeSupplierPaymentReversedEvent(
  tx: Prisma.TransactionClient,
  params: { paymentId: string; payload: SupplierPaymentReversedEventPayload },
) {
  return writeDomainEvent(tx, {
    eventType: 'SupplierPaymentReversed',
    aggregateType: 'SupplierPayment',
    aggregateId: params.paymentId,
    payload: params.payload,
    idempotencyKey: `SupplierPaymentReversed|${params.paymentId}`,
  });
}

export async function publishSupplierPaymentEvent(params: {
  eventType: 'SupplierPaymentApplied';
  actorId?: string | null;
  entityId: string;
  payload: SupplierPaymentEventPayload;
  meta?: object;
}) {
  await writeAuditLog({
    actorId: params.actorId ?? null,
    action: params.eventType,
    entityType: 'supplier-payment',
    entityId: params.entityId,
    afterData: params.payload,
    meta: params.meta,
  });
}