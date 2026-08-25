import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { casUpdate } from "@/lib/api/cas";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound, failValidation } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const submitSchema = z.object({ version: z.number().int().positive() });

/**
 * POST /api/expenses/:id/submit —— 报销申请提交审批（DRAFT | REJECTED → PENDING）
 *
 * 报销流程补齐（Migration 0051）：复用 ProjectExpense.approvalStatus 枚举，不新增工作流模型。
 * - 状态门禁：仅 DRAFT（首次提交）或 REJECTED（驳回后改稿再提交）可提交；PENDING 幂等冲突、APPROVED 终态禁改
 * - 原子乐观锁：casUpdate（updateMany where id+version → 并发状态迁移触发 version 冲突，消除 read-check-update TOCTOU）
 * - 不创建付款/GL 过账/发票（HOLD）：提交仅迁移审批状态，业务事实仍由后续动作承载
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // submit 映射现有动作（对齐 quotation.submit / purchase-requisition.submit 先例：submit→:edit，不新造权限体系）
  const denied = requirePermission(user, "project-expense:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "project-expense.submit");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = submitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version } = parsed.data;
  const actorId = user!.id;

  const txResult = await prisma.$transaction(async (tx) => {
    const existing = await tx.projectExpense.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return { error: "NOT_FOUND" as const };
    if (existing.approvalStatus !== "DRAFT" && existing.approvalStatus !== "REJECTED") {
      return { error: "INVALID_STATE" as const, status: existing.approvalStatus };
    }
    const cas = await casUpdate(tx, "projectExpense", id, version, {
      approvalStatus: "PENDING",
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
      `仅草稿或已驳回状态可提交（当前 ${(txResult as { status?: string }).status}）`,
    );
  }
  if (txResult.error === "VERSION_CONFLICT") {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }
  const updated = txResult.updated!;

  await writeAuditLog({
    actorId,
    action: "project-expense.submit",
    entityType: "projectExpense",
    entityId: id,
    beforeData: { approvalStatus: "DRAFT" as const, version },
    afterData: { approvalStatus: updated.approvalStatus },
    ...meta,
  });

  return ok({ id, approvalStatus: updated.approvalStatus });
}
