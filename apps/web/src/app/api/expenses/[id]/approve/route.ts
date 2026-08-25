import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { casUpdate } from "@/lib/api/cas";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound, failValidation } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const approveSchema = z.object({ version: z.number().int().positive() });

/**
 * POST /api/expenses/:id/approve —— 报销申请批准（PENDING → APPROVED）
 *
 * 报销流程补齐（Migration 0051）：复用 ProjectExpense.approvalStatus 枚举，不新增工作流模型。
 * - 状态门禁：仅 PENDING 可批准；批准人写入 approvedById（详情页「审批人」事实）
 * - 原子乐观锁：casUpdate（id+version 条件更新，并发批准/驳回/提交互斥）
 * - 不触发付款/GL 自动过账/发票 OCR（HOLD）：批准仅终结审批状态
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-expense:approve");
  if (denied) return denied;
  requestLog(request, user?.id, "project-expense.approve");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = approveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version } = parsed.data;
  const actorId = user!.id;

  const txResult = await prisma.$transaction(async (tx) => {
    const existing = await tx.projectExpense.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return { error: "NOT_FOUND" as const };
    if (existing.approvalStatus !== "PENDING") {
      return { error: "INVALID_STATE" as const, status: existing.approvalStatus };
    }
    const cas = await casUpdate(tx, "projectExpense", id, version, {
      approvalStatus: "APPROVED",
      approvedById: actorId,
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
      `仅待审批状态可批准（当前 ${(txResult as { status?: string }).status}）`,
    );
  }
  if (txResult.error === "VERSION_CONFLICT") {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }
  const updated = txResult.updated!;

  await writeAuditLog({
    actorId,
    action: "project-expense.approve",
    entityType: "projectExpense",
    entityId: id,
    beforeData: { approvalStatus: "PENDING" as const, version },
    afterData: { approvalStatus: updated.approvalStatus, approvedById: actorId },
    ...meta,
  });

  return ok({ id, approvalStatus: updated.approvalStatus, approvedById: actorId });
}
