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
 * POST /api/quotations/:id/accept（客户接受报价，Action API）
 * 规则：effectiveStatus != EXPIRED（否则 409）；仅 APPROVED/SENT 可接受；
 * 成功：status=ACCEPTED，生成 QuotationSnapshot(ACCEPTED)，发布 QuotationAccepted。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // accept 映射现有动作（CTO：新动作不破坏 RBAC 规范）
  const denied = requirePermission(user, "quotation:approve");
  if (denied) return denied;
  requestLog(request, user?.id, "quotation.accept");

  const { id } = await params;
  const meta = requestMeta(request);

  const quotation = await prisma.quotation.findFirst({ where: { id, deletedAt: null } });
  if (!quotation) return failNotFound(ERROR_CODES.QUOTATION_NOT_FOUND, "报价单不存在");

  const eff = effectiveStatusOf(quotation);
  if (eff.isExpired) {
    return failConflict(ERROR_CODES.QUOTATION_EXPIRED, "报价已过期，禁止接受");
  }
  if (quotation.status !== "APPROVED" && quotation.status !== "SENT") {
    return failConflict(ERROR_CODES.QUOTATION_INVALID_STATE, "仅 APPROVED/SENT 状态可接受");
  }

  const actorId = user!.id;
  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.quotation.update({
      where: { id },
      data: { status: "ACCEPTED", updatedById: actorId },
    });
    const latestRevision = await tx.quotationRevision.findFirst({
      where: { quotationId: id, deletedAt: null },
      orderBy: { revisionNo: "desc" },
    });
    await tx.quotationSnapshot.create({
      data: {
        quotationId: id,
        snapshotType: "ACCEPTED",
        revisionNo: latestRevision?.revisionNo ?? 1,
        snapshotData: {
          status: "ACCEPTED",
          totalAmount: saved.totalAmount.toNumber(),
          currency: saved.currency,
          acceptedBy: actorId,
          acceptedAt: new Date().toISOString(),
        },
        generatedById: actorId,
        createdById: actorId,
        updatedById: actorId,
      },
    });
    return saved;
  });

  try {
    await publishQuotationEvent({
      eventType: "QuotationAccepted",
      actorId,
      entityId: id,
      payload: {
        quotationId: id,
        quotationCode: updated.code,
        revisionNo: 1,
        customerId: updated.customerId,
        projectId: updated.projectId,
        workflowInstanceId: updated.workflowInstanceId,
        currency: updated.currency,
        totalAmount: updated.totalAmount,
      },
      meta,
    });
    await writeAuditLog({
      actorId,
      action: "quotation.accept",
      entityType: "quotation",
      entityId: id,
      afterData: { status: "ACCEPTED" },
      ...meta,
    });
  } catch {
    // 事件/审计失败不阻断主流程
  }

  return ok({ id, status: "ACCEPTED" });
}
