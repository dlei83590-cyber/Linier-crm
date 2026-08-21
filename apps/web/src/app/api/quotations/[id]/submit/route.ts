import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { effectiveStatusOf } from "@/lib/quotation/helpers";
import { publishQuotationEvent } from "@/lib/quotation/events";

export const dynamic = "force-dynamic";

/**
 * POST /api/quotations/:id/submit —— DRAFT → APPROVED（auto-approve：移除审核，提交即生效——后续审核打通后恢复 SUBMITTED + 审批）
 * - 校验：仅 DRAFT；至少一条有效 Line；未过期
 * - **auto-approve（移除审核）**：DRAFT → APPROVED 同事务（approvalStatus=APPROVED + approvedAt/approvedById=提交人），
 *   跳过 ApprovalPolicy 匹配与 WorkflowInstance 创建（不再报 QUOTATION_APPROVAL_POLICY_NOT_FOUND）；
 *   生成 QuotationSnapshot(APPROVED)；发布 QuotationSubmitted
 * - 红线：APPROVED ≠ ACCEPTED/CONVERTED——accept 仍需显式动作（accept 门禁 status=APPROVED/SENT 已满足）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // submit 映射现有动作（CTO：新动作不破坏 RBAC 规范，后续 ADR 再扩展）
  const denied = requirePermission(user, "quotation:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "quotation.submit");

  const { id } = await params;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const quotation = await prisma.quotation.findFirst({
    where: { id, deletedAt: null },
    include: { lines: { where: { deletedAt: null } } },
  });
  if (!quotation) return failNotFound(ERROR_CODES.QUOTATION_NOT_FOUND, "报价单不存在");
  if (quotation.status !== "DRAFT") {
    return failConflict(ERROR_CODES.QUOTATION_INVALID_STATE, "仅 DRAFT 状态可提交");
  }
  if (quotation.lines.length === 0) {
    return failConflict(ERROR_CODES.QUOTATION_NO_LINES, "报价单至少需要一行明细");
  }
  if (effectiveStatusOf(quotation).isExpired) {
    return failConflict(ERROR_CODES.QUOTATION_EXPIRED, "报价已过期，禁止提交");
  }

  const totalAmount = quotation.totalAmount;

  const updated = await prisma.$transaction(async (tx) => {
    // auto-approve（移除审核：提交即生效——DRAFT → APPROVED 同事务，跳过 ApprovalPolicy 匹配与 WorkflowInstance 创建）
    const saved = await tx.quotation.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvalStatus: "APPROVED",
        approvedAt: new Date(),
        approvedById: actorId,
        updatedById: actorId,
      },
    });
    const latestRevision = await tx.quotationRevision.findFirst({
      where: { quotationId: id, deletedAt: null },
      orderBy: { revisionNo: "desc" },
    });
    await tx.quotationSnapshot.create({
      data: {
        quotationId: id,
        snapshotType: "APPROVED",
        revisionNo: latestRevision?.revisionNo ?? 1,
        snapshotData: {
          status: "APPROVED",
          totalAmount: totalAmount.toString(),
          currency: quotation.currency,
          approvedBy: actorId,
          approvedAt: new Date().toISOString(),
        },
        generatedById: actorId,
        createdById: actorId,
        updatedById: actorId,
      },
    });
    return saved;
  });

  try {
    const latestRevision = await prisma.quotationRevision.findFirst({
      where: { quotationId: id, deletedAt: null },
      orderBy: { revisionNo: "desc" },
    });
    await publishQuotationEvent({
      eventType: "QuotationSubmitted",
      actorId,
      entityId: id,
      payload: {
        quotationId: id,
        quotationCode: quotation.code,
        revisionNo: latestRevision?.revisionNo ?? 1,
        customerId: quotation.customerId,
        projectId: quotation.projectId,
        workflowInstanceId: null,
        currency: quotation.currency,
        totalAmount: quotation.totalAmount,
        submittedBy: actorId,
      },
      meta,
    });
    await writeAuditLog({
      actorId,
      action: "quotation.submit",
      entityType: "quotation",
      entityId: id,
      beforeData: { status: "DRAFT" },
      afterData: { status: updated.status, approvalStatus: updated.approvalStatus, totalAmount: quotation.totalAmount },
      ...meta,
    });
  } catch {
    // 事件/审计失败不阻断主流程（总线未落地前为 AuditLog 留痕）
  }

  return ok({
    id,
    status: updated.status,
    approvalStatus: updated.approvalStatus,
    workflowSkipped: "no-policy" as const,
    resubmitted: false,
  });
}
