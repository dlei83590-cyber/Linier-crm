import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, fail } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { creditDebitNoteSubmitSchema } from "@/lib/api/schemas";
import { maybeTriggerCreditDebitNoteApproval } from "@/lib/credit-debit-note/workflow-sync";
import { publishCreditDebitNoteEvent } from "@/lib/credit-debit-note/events";

export const dynamic = "force-dynamic";

type SubmitResult =
  | { error: "CN_DN_NOT_FOUND" }
  | { error: "INVALID_STATE"; status: string }
  | {
      note: { id: string; code: string; status: string; approvalStatus: string; workflowInstanceId: string | null };
      workflow: { triggered: boolean; instanceId?: string | null; resubmitted?: boolean; skipped?: string };
    };

/**
 * POST /api/credit-debit-notes/:id/submit —— DRAFT → SUBMITTED（用户 #5533 Phase 3 指令 + CTO 98/100）
 * - 只允许 DRAFT → SUBMITTED（否则 409 CN_DN_INVALID_STATE）；
 * - 同事务调用 `maybeTriggerCreditDebitNoteApproval()`（module=CREDIT_DEBIT_NOTE 按 note.adjustmentTotal 匹配金额区间）：
 *   - **命中策略** → 创建/复用 Workflow 实例，approvalStatus=PENDING → **必须等 APPROVED 后才能 Apply**（Apply 路由门禁）
 *   - **未命中策略** → 保持 SUBMITTED（approvalStatus 仍 DRAFT）→ **可直接进入可 Apply 状态**
 * - **Workflow 配置异常必须让事务回滚，不能静默**（命中策略后 WorkflowDefinition 缺失 → 显式抛错 →
 *   主事务整体回滚 → 映射 409 CN_DN_WORKFLOW_FAILED）；
 * - **红线（CTO 锁死）**：Submit **绝不能修改 AR.adjustedAmount**（事实由 Apply 事务生成）；
 *   也不创建 InvoiceAdjustment、不改 Invoice.balanceAmount。
 * - 事件：CreditDebitNoteSubmitted + CreditDebitNoteApprovalStarted（命中策略时由 workflow-sync 发布；失败降级不阻断）
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

  let result: SubmitResult;
  try {
    result = await prisma.$transaction(async (tx) => {
      // 1. Lock CreditDebitNote（FOR UPDATE）
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "CreditDebitNote" WHERE "id" = ${noteId} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (locked.length === 0) return { error: "CN_DN_NOT_FOUND" as const };
      const note = await tx.creditDebitNote.findFirst({ where: { id: noteId, deletedAt: null } });
      if (!note) return { error: "CN_DN_NOT_FOUND" as const };

      // 2. 状态校验：仅 DRAFT 可提交
      if (note.status !== "DRAFT") {
        return { error: "INVALID_STATE" as const, status: note.status };
      }

      // 3. DRAFT → SUBMITTED（同事务）
      const updated = await tx.creditDebitNote.update({
        where: { id: note.id },
        data: { status: "SUBMITTED", updatedById: user?.id ?? null },
        select: { id: true, code: true, status: true, approvalStatus: true, workflowInstanceId: true },
      });

      // 4. 条件触发审批（同事务；命中策略 → approvalStatus=PENDING + workflowInstanceId；未命中 → skipped）
      //    **绝不修改 AR.adjustedAmount**（红线）；Workflow 配置异常 → 抛错 → 整体回滚（下方映射 CN_DN_WORKFLOW_FAILED）
      const wf = await maybeTriggerCreditDebitNoteApproval({
        noteId: note.id,
        actorId: user!.id,
        meta,
        tx,
      });

      return { note: updated, workflow: wf };
    });
  } catch (e) {
    // Workflow 配置异常（命中策略但定义缺失/不可用）→ 主事务已回滚 → 显式 409，不静默
    if (e instanceof Error && e.message === "WORKFLOW_DEFINITION_NOT_FOUND") {
      return failConflict(
        ERROR_CODES.CN_DN_WORKFLOW_FAILED,
        "命中审批策略但工作流定义缺失或未激活，提交已回滚",
      );
    }
    throw e;
  }

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

  // 5. 事件 + 审计（事务外，事件失败降级不阻断）
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
        approvalStatus: note?.approvalStatus ?? "DRAFT",
        workflowTriggered: result.workflow.triggered,
        workflowSkipped: result.workflow.skipped ?? null,
      },
      meta,
    });
    await writeAuditLog({
      actorId: user?.id,
      action: "credit-debit-note.submit",
      entityType: "credit-debit-note",
      entityId: noteId,
      afterData: {
        status: "SUBMITTED",
        workflowTriggered: result.workflow.triggered,
        workflowSkipped: result.workflow.skipped ?? null,
        workflowInstanceId: result.note.workflowInstanceId ?? null,
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
    approvalStatus: result.note.approvalStatus,
    workflowTriggered: result.workflow.triggered,
    workflowInstanceId: result.workflow.instanceId ?? null,
    workflowSkipped: result.workflow.skipped ?? null,
  });
}
