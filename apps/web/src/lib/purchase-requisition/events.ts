import { writeAuditLog } from '@/lib/api-helpers';

/** Sprint 5A - PurchaseRequisition Domain Events 发布（EVENTS.md v1.14 已注册 5 个 PR 事件）
 * 事件总线尚未落地（Known Risk），当前以 AuditLog 留痕；总线落地后替换为 publish。
 * 已实现：PurchaseRequisitionCreated / Submitted / Approved / Rejected（Converted 属 PO 阶段显式动作，届时实现）。
 * 红线（CTO Design Review 拍板⑤）：PR = 需求事实源，载荷**不得包含金额/单价/税额**等采购承诺事实。
 */

export interface PurchaseRequisitionEventPayload {
  requisitionId: string;
  requisitionCode?: string | null;
  requesterId?: string | null;
  departmentId?: string | null;
  workflowInstanceId?: string | null;
  [key: string]: unknown;
}

export async function publishPurchaseRequisitionEvent(params: {
  eventType: string;
  actorId?: string | null;
  entityId: string;
  payload: PurchaseRequisitionEventPayload;
  meta?: object;
}) {
  await writeAuditLog({
    actorId: params.actorId ?? null,
    action: params.eventType,
    entityType: 'purchase-requisition',
    entityId: params.entityId,
    afterData: params.payload,
    meta: params.meta,
  });
}
