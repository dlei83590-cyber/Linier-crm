import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, failServer } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const closeSchema = z
  .object({
    reason: z.string().min(1).max(500),
    summary: z.string().max(1000).optional(),
    force: z.boolean().optional(), // CTO #3C5：强制结项（需 project:close + project:approve）
    version: z.number().int().positive(),
  })
  .refine((v) => !v.force || (v.reason && v.reason.trim().length > 0), { message: "强制结项必须填写原因" });

/**
 * POST /api/projects/:id/close — 项目结项唯一入口（CTO #3C5，不是 PATCH 改状态）
 * 默认强制阻断（409）：存在未完成任务 / 未关闭风险 / 尚未验收 / 未回款或有应收余额。
 * 强制结项：force=true + reason + version，需 project:close + project:approve 双权限；
 * 写 AuditLog + ProjectProgress 备注 + ProjectClosure（记录操作者和原因）；禁止普通 edit 绕过。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project:close");
  if (denied) return denied;
  requestLog(request, user?.id, "project.close");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = closeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const force = parsed.data.force === true;
  if (force) {
    // 强制结项需要双权限：project:close + project:approve（CTO #3C5，不允许 edit 绕过）
    const deniedApprove = requirePermission(user, "project:approve");
    if (deniedApprove) return deniedApprove;
  }

  const existing = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "项目不存在");
  if (existing.version !== parsed.data.version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }
  if (existing.stage === "CLOSED") {
    return failConflict(ERROR_CODES.CONFLICT, "项目已结项");
  }

  // 结项检查（CTO #3C5：默认强制阻断）
  const [openTasks, openRisks, acceptances] = await Promise.all([
    prisma.projectTask.count({ where: { projectId: id, deletedAt: null, status: { notIn: ["DONE", "CANCELLED"] } } }),
    prisma.projectRisk.count({ where: { projectId: id, deletedAt: null, status: { not: "CLOSED" } } }),
    prisma.projectAcceptance.findMany({ where: { projectId: id, deletedAt: null }, select: { result: true } }),
  ]);

  const hasAcceptancePassed = acceptances.some((a) => a.result === "PASSED");
  const hasReceivable = existing.paymentStatus !== "PAID" || (existing.receivableBalance?.greaterThan(0) ?? false);

  const issues: string[] = [];
  if (openTasks > 0) issues.push(`存在 ${openTasks} 个未完成任务`);
  if (openRisks > 0) issues.push(`存在 ${openRisks} 个未关闭风险`);
  if (!hasAcceptancePassed) issues.push("项目尚未验收通过");
  if (hasReceivable) issues.push("存在未完成回款或应收余额");

  if (issues.length > 0 && !force) {
    return failConflict(ERROR_CODES.CONFLICT, `结项被阻断：${issues.join("；")}（如需强制结项，请提供 force=true + 原因，并需 project:close + project:approve 权限）`);
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 创建结项记录（记录操作者和原因）
      const createdClosure = await tx.projectClosure.create({
        data: {
          projectId: id,
          closedAt: new Date(),
          reason: parsed.data.reason,
          summary: parsed.data.summary ?? (force ? `强制结项：${parsed.data.reason}` : parsed.data.reason),
          approvalStatus: "APPROVED",
          createdById: user!.id,
          updatedById: user!.id,
        },
      });

      // 更新项目状态：CLOSED + version+1
      const updatedProject = await tx.project.update({
        where: { id },
        data: { stage: "CLOSED", version: { increment: 1 }, updatedById: user!.id },
      });

      // 强制结项必须写 ProjectProgress 备注（CTO #3C5）
      if (force) {
        await tx.projectProgress.create({
          data: {
            projectId: id,
            progressPercent: 100,
            summary: `强制结项：${parsed.data.reason}（操作人：${user?.email ?? user?.id ?? "unknown"}）`,
            approvalStatus: "APPROVED",
            createdById: user!.id,
          },
        });
      }

      return { createdClosure, updatedProject };
    });

    await writeAuditLog({
      actorId: user?.id,
      action: force ? "project.force-close" : "project.close",
      entityType: "project",
      entityId: id,
      beforeData: { stage: existing.stage, paymentStatus: existing.paymentStatus, receivableBalance: existing.receivableBalance },
      afterData: { stage: "CLOSED", reason: parsed.data.reason, force, closedBy: user?.id },
      ...meta,
    });

    // Domain Event：ProjectClosed / ProjectForceClosed（EVENTS.md 注册；事件总线 Sprint 4 前落地）

    return ok({ id, stage: "CLOSED", closureId: result.createdClosure.id, force });
  } catch {
    return failServer("结项失败，请稍后重试");
  }
}
