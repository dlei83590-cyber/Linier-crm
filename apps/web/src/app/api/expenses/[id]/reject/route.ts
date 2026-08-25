import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { casUpdate } from "@/lib/api/cas";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound, failValidation } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const rejectSchema = z.object({
  version: z.number().int().positive(),
  // 驳回原因必填（可编辑后重新提交）；trim 后非空——事务前校验，避免空原因入事务
  reason: z
    .string()
    .min(1)
    .max(500)
    .refine((v) => v.trim().length > 0, { message: "驳回原因不能为空" }),
});

/**
 * POST /api/expenses/:id/reject —— 报销申请驳回（PENDING → REJECTED）
 *
 * 报销流程补齐（Migration 0051）：复用 ProjectExpense.approvalStatus 枚举，不新增工作流模型。
 * - 状态门禁：仅 PENDING 可驳回；驳回原因必填（rejectionReason）+ 驳回人（rejectedById）
 * - 原子乐观锁：casUpdate（id+version 条件更新，并发批准/驳回互斥）
 * - REJECTED 后可编辑并重新提交（submit 门禁 DRAFT|REJECTED → PENDING）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-expense:approve");
  if (denied) return denied;
  requestLog(request, user?.id, "project-expense.reject");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = rejectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version, reason } = parsed.data;
  const actorId = user!.id;

  const txResult = await prisma.$transaction(async (tx) => {
    const existing = await tx.projectExpense.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return { error: "NOT_FOUND" as const };
    if (existing.approvalStatus !== "PENDING") {
      return { error: "INVALID_STATE" as const, status: existing.approvalStatus };
    }
    const cas = await casUpdate(tx, "projectExpense", id, version, {
      approvalStatus: "REJECTED",
      rejectionReason: reason.trim(),
      rejectedById: actorId,
      updatedById: actorId,
    });
    if (cas.outcome === "NOT_FOUND") return { error: "NOT_FOUND" as const };
    if (cas.outcome === "CONFLICT") return { error: "VERSION_CONFLICT" as const };
    const updated = await tx.projectExpense.findFirst({ where: { id, deletedAt: null } });
    return { error: null as null, updated };
  });
  if (txResult.error === "NOT_FOUND") {
    return failNotFound(ERROR_CODES.EXPENSE_NOT_FOUND, "报销申请不存在");
  }
  if (txResult.error === "INVALID_STATE") {
    return failConflict(
      ERROR_CODES.EXPENSE_INVALID_STATE,
      `仅待审批状态可驳回（当前 ${(txResult as { status?: string }).status}）`,
    );
  }
  if (txResult.error === "VERSION_CONFLICT") {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }
  const updated = txResult.updated!;

  await writeAuditLog({
    actorId,
    action: "project-expense.reject",
    entityType: "projectExpense",
    entityId: id,
    beforeData: { approvalStatus: "PENDING" as const, version },
    afterData: { approvalStatus: updated.approvalStatus, rejectionReason: reason.trim() },
    ...meta,
  });

  return ok({ id, approvalStatus: updated.approvalStatus, rejectedById: actorId });
}
