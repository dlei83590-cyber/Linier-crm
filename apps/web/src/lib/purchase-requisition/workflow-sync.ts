import { prisma } from '@/lib/prisma';
import { publishPurchaseRequisitionEvent } from '@/lib/purchase-requisition/events';

/**
 * Sprint 5A - PurchaseRequisition ↔ Workflow 集成（条件审批）
 * 设计依据：ADR-0023（Approved with Changes）+ Phase 3 指令：
 *   - Submit 后进入条件 Workflow（module=PURCHASE_REQUISITION），**审批只改变 PR 审批/状态投影，不创建 PO**；
 *   - WorkflowInstance/WorkflowAction/WorkflowHistory 为唯一审批事实源，PR 仅保存投影
 *     （workflowInstanceId / approvalStatus / approvedAt / approvedById）；
 *   - 单实例架构：WorkflowInstance @@unique([businessType, businessId]) 保持不变；不建 PurchaseRequisitionApproval 表；
 *   - PR 无金额事实 → 策略规则不按金额区间匹配（优先无金额约束规则，否则取 priority DESC 首条）；
 *   - 驳回 → PR 回到 DRAFT 重提（EVENTS.md：PurchaseRequisitionRejected（→ DRAFT 重提））；
 *   - PR → PO Convert 留到 PO 阶段显式动作，审批通过不自动建 PO。
 */

/**
 * 审批终态回写（调用方：workflows/instances/[id]/actions，businessType === "purchase-requisition"）
 * COMPLETED → status=APPROVED + approvalStatus=APPROVED + approvedAt + approvedById；
 * REJECTED → status=DRAFT（可重提）+ approvalStatus=REJECTED。
 * PR 无 Snapshot 模型（仅 Revision），审批终态只回写投影、不生成快照。
 * 投影失败不得静默（对齐 quotation 先例：不 catch）；事件发布失败在 sync 内部降级。
 */
export async function syncPurchaseRequisitionApproval(params: {
  requisitionId: string;
  workflowStatus: string; // COMPLETED | REJECTED
  actorId: string;
}) {
  const pr = await prisma.purchaseRequisition.findFirst({
    where: { id: params.requisitionId, deletedAt: null },
  });
  if (!pr) return;

  if (params.workflowStatus === 'COMPLETED') {
    await prisma.purchaseRequisition.update({
      where: { id: pr.id },
      data: {
        status: 'APPROVED',
        approvalStatus: 'APPROVED',
        approvedAt: new Date(),
        approvedById: params.actorId,
        updatedById: params.actorId,
      },
    });
    await publishPurchaseRequisitionEvent({
      eventType: 'PurchaseRequisitionApproved',
      actorId: params.actorId,
      entityId: pr.id,
      payload: {
        requisitionId: pr.id,
        requisitionCode: pr.code,
        requesterId: pr.requesterId,
        departmentId: pr.departmentId,
        workflowInstanceId: pr.workflowInstanceId,
        approvedBy: params.actorId,
        approvedAt: new Date().toISOString(),
      },
    }).catch(() => undefined);
    return;
  }

  if (params.workflowStatus === 'REJECTED') {
    // 驳回 → DRAFT 重提（EVENTS.md 口径：PurchaseRequisitionRejected（→ DRAFT 重提））
    await prisma.purchaseRequisition.update({
      where: { id: pr.id },
      data: { status: 'DRAFT', approvalStatus: 'REJECTED', updatedById: params.actorId },
    });
    await publishPurchaseRequisitionEvent({
      eventType: 'PurchaseRequisitionRejected',
      actorId: params.actorId,
      entityId: pr.id,
      payload: {
        requisitionId: pr.id,
        requisitionCode: pr.code,
        requesterId: pr.requesterId,
        departmentId: pr.departmentId,
        workflowInstanceId: pr.workflowInstanceId,
        rejectedBy: params.actorId,
        rejectedAt: new Date().toISOString(),
      },
    }).catch(() => undefined);
  }
}
