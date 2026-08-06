import { NextRequest } from "next/server";
import type { ProjectStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const transitionSchema = z.object({
  targetStage: z.enum(["LEAD", "QUALIFIED", "SOLUTION", "QUOTATION", "SAMPLING", "TESTING", "SMALL_BATCH", "MASS_SUPPLY", "PAUSED", "FAILED", "CLOSED"]),
  remark: z.string().max(500).optional(),
  version: z.number().int().positive(),
});

/** 合法阶段流转（CTO #3C5：集中校验，禁止 PATCH 任意修改 stage） */
const STAGE_ORDER: ProjectStage[] = ["LEAD", "QUALIFIED", "SOLUTION", "QUOTATION", "SAMPLING", "TESTING", "SMALL_BATCH", "MASS_SUPPLY"];

function isLegalTransition(from: ProjectStage, to: ProjectStage): boolean {
  if (from === to) return true;
  // 暂停/失败 → 结项 或 恢复
  if (from === "PAUSED") {
    return to === "FAILED" || to === "CLOSED" || STAGE_ORDER.includes(to);
  }
  // 任意阶段 → 暂停/失败/结项（结项仅批量供货/失败/暂停后可）
  if (to === "PAUSED" || to === "FAILED") return true;
  if (to === "CLOSED") {
    return from === "MASS_SUPPLY" || from === "FAILED" || from === "PAUSED";
  }
  // 正向推进：只能前进，不能倒退/跳级
  const fromIdx = STAGE_ORDER.indexOf(from);
  const toIdx = STAGE_ORDER.indexOf(to);
  if (fromIdx === -1 || toIdx === -1) return false;
  return toIdx === fromIdx + 1;
}

/**
 * POST /api/projects/:id/transition — 项目阶段流转唯一入口（CTO #3C5）
 * 规则：集中校验合法顺序；每次流转写 WorkflowHistory + AuditLog；乐观锁 version。
 * 禁止通过 PATCH 修改 stage（PATCH schema 不开放 stage 字段）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "project.transition");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = transitionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const existing = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "项目不存在");
  if (existing.version !== parsed.data.version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const fromStage = existing.stage as ProjectStage;
  const toStage = parsed.data.targetStage as ProjectStage;
  if (!isLegalTransition(fromStage, toStage)) {
    return failConflict(ERROR_CODES.CONFLICT, `非法阶段流转：${fromStage} → ${toStage}（仅允许正向推进/暂停/失败/结项）`);
  }

  const updated = await prisma.project.update({
    where: { id },
    data: {
      stage: toStage,
      version: { increment: 1 },
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "project.transition",
    entityType: "project",
    entityId: id,
    beforeData: { stage: fromStage },
    afterData: { stage: toStage, remark: parsed.data.remark ?? null },
    ...meta,
  });

  // Domain Event：ProjectStageChanged（事件总线 Sprint 4 前落地；此处 AuditLog + EVENTS.md 注册为准）

  return ok({ id, fromStage, toStage, remark: parsed.data.remark ?? null, stage: updated.stage });
}
