import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, fail } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { creditDebitNoteSubmitSchema } from "@/lib/api/schemas";
import { publishCreditDebitNoteEvent } from "@/lib/credit-debit-note/events";

export const dynamic = "force-dynamic";

/**
 * POST /api/credit-debit-notes/:id/submit —— DRAFT → SUBMITTED + approvalStatus=APPROVED（auto-approve：移除审核，提交即生效）
 * - 只允许 DRAFT → SUBMITTED（否则 409 CN_DN_INVALID_STATE）；CAS 语义由 update 条件保证
 * - **auto-approve（移除审核）**：同事务 approvalStatus=APPROVED + approvedAt/approvedById=提交人（跳过 ApprovalPolicy/Workflow），
 *   Apply 门禁（status=SUBMITTED + workflowInstanceId==null → 无需 APPROVED 校验）直接放行；
 * - **红线（CTO 锁死）**：Submit 绝不修改 AR.adjustedAmount（事实由 Apply 事务生成）；
 *   也不创建 InvoiceAdjustment、不改 Invoice.balanceAmount。
 * - 事件：CreditDebitNoteSubmitted（失败降级不阻断）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "credit-debit-note:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "credit-debit-note.submit");

  const { id: noteId } = await params;
  const parsed = creditDebitNoteSubmitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { changeReason } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const result = await prisma.$transaction(async (tx) => {
    const note = await tx.creditDebitNote.findFirst({ where: { id: noteId, deletedAt: null } });
    if (!note) return { error: "CN_DN_NOT_FOUND" as const };

    // auto-approve（移除审核：提交即生效——CAS：status=DRAFT 同时命中，防并发双提交）
    const updated = await tx.creditDebitNote.updateMany({
      where: { id: note.id, status: "DRAFT", deletedAt: null },
      data: {
        status: "SUBMITTED",
        approvalStatus: "APPROVED",
        approvedAt: new Date(),
        approvedById: actorId,
        updatedById: actorId,
      },
    });
    if (updated.count !== 1) {
      const cur = await tx.creditDebitNote.findFirst({ where: { id: noteId, deletedAt: null } });
      return { error: "INVALID_STATE" as const, status: cur?.status ?? note.status };
    }

    const saved = await tx.creditDebitNote.findFirstOrThrow({
      where: { id: note.id },
      select: { id: true, code: true, status: true, approvalStatus: true, workflowInstanceId: true },
    });

    return {
      note: saved,
      workflow: { triggered: false as const, skipped: "no-policy" as const, instanceId: null, resubmitted: false },
    };
  });

  if ("error" in result) {
    switch (result.error) {
      case "CN_DN_NOT_FOUND":
        return failNotFound(ERROR_CODES.CN_DN_NOT_FOUND, "CreditDebitNote 不存在");
      case "INVALID_STATE":
        return failConflict(
          ERROR_CODES.CN_DN_INVALID_STATE,
          `仅 DRAFT 状态可提交（当前 status=${result.status}）`,
        );
      default:
        return fail(ERROR_CODES.INTERNAL_ERROR, "提交失败：未知错误", 500);
    }
  }

  // 事件 + 审计（事务外，事件失败降级不阻断）
  try {
    const note = await prisma.creditDebitNote.findFirst({
      where: { id: noteId, deletedAt: null },
      select: {
        id: true,
        code: true,
        noteType: true,
        sourceInvoiceId: true,
        customerId: true,
        currency: true,
        adjustmentTotal: true,
        reason: true,
        approvalStatus: true,
        workflowInstanceId: true,
      },
    });
    await publishCreditDebitNoteEvent({
      eventType: "CreditDebitNoteSubmitted",
      actorId: user?.id,
      entityId: noteId,
      payload: {
        noteId,
        noteCode: note?.code ?? null,
        noteType: note?.noteType ?? null,
        sourceInvoiceId: note?.sourceInvoiceId ?? "",
        customerId: note?.customerId ?? "",
        currency: note?.currency ?? "",
        adjustmentTotal: note?.adjustmentTotal ?? 0,
        reason: note?.reason ?? null,
        workflowInstanceId: note?.workflowInstanceId ?? null,
        approvalStatus: note?.approvalStatus ?? "APPROVED",
        workflowTriggered: false,
        workflowSkipped: "no-policy",
      },
      meta,
    });
    await writeAuditLog({
      actorId: user?.id,
      action: "credit-debit-note.submit",
      entityType: "credit-debit-note",
      entityId: noteId,
      beforeData: { status: "DRAFT" },
      afterData: {
        status: "SUBMITTED",
        approvalStatus: "APPROVED",
        workflowSkipped: "no-policy",
        ...(changeReason ? { changeReason } : {}),
      },
      ...meta,
    });
  } catch {
    // 事件/审计失败不阻断主流程
  }

  return ok({
    creditDebitNoteId: noteId,
    status: "SUBMITTED",
    approvalStatus: "APPROVED",
    workflowTriggered: false,
    workflowInstanceId: null,
    workflowSkipped: "no-policy",
  });
}
