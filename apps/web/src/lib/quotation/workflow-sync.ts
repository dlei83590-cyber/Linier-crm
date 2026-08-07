import { prisma } from "@/lib/prisma";
import { publishQuotationEvent } from "@/lib/quotation/events";

/**
 * Sprint 4A - Quotation ↔ Workflow 集成（Commit 3）
 * 审批终态回写：Workflow 为唯一审批事实源（ADR-0016），Quotation 仅保存投影
 * （approvalStatus / approvedAt / approvedById），并发布 QuotationApproved / QuotationRejected 事件。
 * 调用方：workflows/instances/[id]/actions（终态 COMPLETED/REJECTED 且 businessType === "quotation"）。
 */
export async function syncQuotationApproval(params: {
  quotationId: string;
  workflowStatus: string; // COMPLETED | REJECTED
  actorId: string;
}) {
  const quotation = await prisma.quotation.findFirst({ where: { id: params.quotationId, deletedAt: null } });
  if (!quotation) return;

  if (params.workflowStatus === "COMPLETED") {
    const now = new Date();
    await prisma.quotation.update({
      where: { id: quotation.id },
      data: {
        status: "APPROVED",
        approvalStatus: "APPROVED",
        approvedAt: now,
        approvedById: params.actorId,
        updatedById: params.actorId,
      },
    });
    await publishQuotationEvent({
      eventType: "QuotationApproved",
      actorId: params.actorId,
      entityId: quotation.id,
      payload: {
        quotationId: quotation.id,
        quotationCode: quotation.code,
        revisionNo: 1,
        customerId: quotation.customerId,
        projectId: quotation.projectId,
        workflowInstanceId: quotation.workflowInstanceId,
        currency: quotation.currency,
        totalAmount: quotation.totalAmount,
        approverId: params.actorId,
      },
    }).catch(() => undefined);
    return;
  }

  if (params.workflowStatus === "REJECTED") {
    await prisma.quotation.update({
      where: { id: quotation.id },
      data: {
        status: "REJECTED",
        approvalStatus: "REJECTED",
        updatedById: params.actorId,
      },
    });
    await publishQuotationEvent({
      eventType: "QuotationRejected",
      actorId: params.actorId,
      entityId: quotation.id,
      payload: {
        quotationId: quotation.id,
        quotationCode: quotation.code,
        revisionNo: 1,
        customerId: quotation.customerId,
        projectId: quotation.projectId,
        workflowInstanceId: quotation.workflowInstanceId,
        currency: quotation.currency,
        totalAmount: quotation.totalAmount,
        approverId: params.actorId,
      },
    }).catch(() => undefined);
  }
}
