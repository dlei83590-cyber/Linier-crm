import { writeAuditLog } from '@/lib/api-helpers';

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