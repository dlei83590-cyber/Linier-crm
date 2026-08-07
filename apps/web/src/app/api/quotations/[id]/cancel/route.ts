import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { publishQuotationEvent } from "@/lib/quotation/events";

export const dynamic = "force-dynamic";

/** 允许取消的状态（CTO：允许 DRAFT、SENT；禁止 ACCEPTED、CONVERTED） */
const CANCELLABLE = ["DRAFT", "SUBMITTED", "APPROVED", "SENT"] as const;

/**
 * POST /api/quotations/:id/cancel（取消报价，Action API）
 * 允许 DRAFT / SENT（以及未接受未转换的中间态）；禁止 ACCEPTED / CONVERTED。
 * 成功：status=CANCELLED，发布 QuotationCancelled。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // cancel 映射现有动作（CTO：新动作不破坏 RBAC 规范）
  const denied = requirePermission(user, "quotation:close");
  if (denied) return denied;
  requestLog(request, user?.id, "quotation.cancel");

  const { id } = await params;
  const meta = requestMeta(request);

  const quotation = await prisma.quotation.findFirst({ where: { id, deletedAt: null } });
  if (!quotation) return failNotFound(ERROR_CODES.QUOTATION_NOT_FOUND, "报价单不存在");
  if ((CANCELLABLE as readonly string[]).includes(quotation.status) === false) {
    return failConflict(ERROR_CODES.QUOTATION_INVALID_STATE, "当前状态不允许取消（ACCEPTED/CONVERTED 禁止取消）");
  }

  const actorId = user!.id;
  const updated = await prisma.quotation.update({
    where: { id },
    data: { status: "CANCELLED", updatedById: actorId },
  });

  try {
    const latestRevision = await prisma.quotationRevision.findFirst({
      where: { quotationId: id, deletedAt: null },
      orderBy: { revisionNo: "desc" },
    });
    await publishQuotationEvent({
      eventType: "QuotationCancelled",
      actorId,
      entityId: id,
      payload: {
        quotationId: id,
        quotationCode: updated.code,
        revisionNo: latestRevision?.revisionNo ?? 1,
        customerId: updated.customerId,
        projectId: updated.projectId,
        workflowInstanceId: updated.workflowInstanceId,
        currency: updated.currency,
        totalAmount: updated.totalAmount,
        cancelledBy: actorId,
      },
      meta,
    });
    await writeAuditLog({
      actorId,
      action: "quotation.cancel",
      entityType: "quotation",
      entityId: id,
      afterData: { status: "CANCELLED" },
      ...meta,
    });
  } catch {
    // 事件/审计失败不阻断主流程
  }

  return ok({ id, status: "CANCELLED" });
}
