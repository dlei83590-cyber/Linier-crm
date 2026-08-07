import { prisma } from "@/lib/prisma";
import { publishQuotationEvent } from "@/lib/quotation/events";

/**
 * Sprint 4A - Quotation ↔ Workflow 集成（Commit 3）
 * 审批终态回写：Workflow 为唯一审批事实源（ADR-0016），Quotation 仅保存投影
 * （approvalStatus / approvedAt / approvedById），并发布 QuotationApproved / QuotationRejected 事件。
 * 调用方：workflows/instances/[id]/actions（终态 COMPLETED/REJECTED 且 businessType === "quotation"）。
 *
 * CTO Final Review（PR #12）：Quotation 投影不得静默失败——
 * COMPLETED 时状态回写 + QuotationSnapshot(APPROVED) 在同一事务完成；
 * 事件发布失败可降级（总线未落地前 AuditLog 留痕），但数据库投影失败必须向上抛（调用方不得 .catch 吞掉）。
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
    // 状态投影 + APPROVED 快照：同一事务（任一步失败整体回滚并向上抛，不静默）
    const { revisionNo } = await prisma.$transaction(async (tx) => {
      const latestRevision = await tx.quotationRevision.findFirst({
        where: { quotationId: quotation.id, deletedAt: null },
        orderBy: { revisionNo: "desc" },
      });
      const revNo = latestRevision?.revisionNo ?? 1;

      await tx.quotation.update({
        where: { id: quotation.id },
        data: {
          status: "APPROVED",
          approvalStatus: "APPROVED",
          approvedAt: now,
          approvedById: params.actorId,
          updatedById: params.actorId,
        },
      });

      // 关键 Snapshot 节点（ADR-0016 决策⑤）：APPROVED（去重防重复终态调用撞唯一约束）
      const existing = await tx.quotationSnapshot.findFirst({
        where: { quotationId: quotation.id, snapshotType: "APPROVED", deletedAt: null },
        select: { id: true },
      });
      if (!existing) {
        await tx.quotationSnapshot.create({
          data: {
            quotationId: quotation.id,
            snapshotType: "APPROVED",
            revisionNo: revNo,
            snapshotData: {
              status: "APPROVED",
              totalAmount: quotation.totalAmount.toString(),
              currency: quotation.currency,
              approvedBy: params.actorId,
              approvedAt: now.toISOString(),
            },
            generatedById: params.actorId,
            createdById: params.actorId,
            updatedById: params.actorId,
          },
        });
      }
      return { revisionNo: revNo };
    });

    await publishQuotationEvent({
      eventType: "QuotationApproved",
      actorId: params.actorId,
      entityId: quotation.id,
      payload: {
        quotationId: quotation.id,
        quotationCode: quotation.code,
        revisionNo,
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
    const { revisionNo } = await prisma.$transaction(async (tx) => {
      const latestRevision = await tx.quotationRevision.findFirst({
        where: { quotationId: quotation.id, deletedAt: null },
        orderBy: { revisionNo: "desc" },
      });
      await tx.quotation.update({
        where: { id: quotation.id },
        data: {
          status: "REJECTED",
          approvalStatus: "REJECTED",
          updatedById: params.actorId,
        },
      });
      return { revisionNo: latestRevision?.revisionNo ?? 1 };
    });

    await publishQuotationEvent({
      eventType: "QuotationRejected",
      actorId: params.actorId,
      entityId: quotation.id,
      payload: {
        quotationId: quotation.id,
        quotationCode: quotation.code,
        revisionNo,
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
