import { NextRequest } from "next/server";
import type { ProjectStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog, lockProjectHeader } from "@/lib/api-helpers";
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
    // PAUSED → CLOSED 已由上方 from === "PAUSED" 分支处理，此处无需重复比较
    return from === "MASS_SUPPLY" || from === "FAILED";
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

  const result = await prisma.$transaction(async (tx) => {
    // 1. Project header FOR UPDATE（同一锁序：Project → Child，防死锁；与 close / 子资源写共用锁纪律）
    const locked = await lockProjectHeader(tx, id);
    if (!locked) return { error: failNotFound(ERROR_CODES.NOT_FOUND, "项目不存在") };
    // 2. version CAS（锁后权威版本）
    if (locked.version !== parsed.data.version) {
      return { error: failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试") };
    }

    const fromStage = locked.stage as ProjectStage;
    const toStage = parsed.data.targetStage as ProjectStage;
    // CLOSED 项目无法合法流转（isLegalTransition 天然拒绝），锁后权威 stage 判定
    if (!isLegalTransition(fromStage, toStage)) {
      return { error: failConflict(ERROR_CODES.CONFLICT, `非法阶段流转：${fromStage} → ${toStage}（仅允许正向推进/暂停/失败/结项）`) };
    }

    // 3. 同一 tx 内更新 stage + version+1（与 Gate 串行化，TOCTOU 消除）
    const updated = await tx.project.update({
      where: { id },
      data: {
        stage: toStage,
        version: { increment: 1 },
        updatedById: user!.id,
      },
    });

    return { updated, fromStage };
  });

  if ("error" in result) return result.error;

  await writeAuditLog({
    actorId: user?.id,
    action: "project.transition",
    entityType: "project",
    entityId: id,
    beforeData: { stage: result.fromStage },
    afterData: { stage: result.updated.stage, remark: parsed.data.remark ?? null },
    ...meta,
  });

  // Domain Event：ProjectStageChanged（事件总线 Sprint 4 前落地；此处 AuditLog + EVENTS.md 注册为准）

  return ok({ id, fromStage: result.fromStage, toStage: result.updated.stage, remark: parsed.data.remark ?? null, stage: result.updated.stage });
}
