import { NextRequest } from "next/server";
import type { MilestoneStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog, assertProjectWritable } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const milestoneUpdateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    plannedDate: z.string().datetime().nullable().optional(),
    actualDate: z.string().datetime().nullable().optional(),
    status: z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "DELAYED"]).optional(),
    deliverable: z.string().max(500).nullable().optional(),
    delayReason: z.string().max(500).nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/projects/:id/milestones/:mid（里程碑详情） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; mid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-milestone:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-milestone.get");

  const { id, mid } = await params;
  const item = await prisma.projectMilestone.findFirst({ where: { id: mid, projectId: id, deletedAt: null } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "里程碑不存在");
  return ok(item);
}

/** PATCH /api/projects/:id/milestones/:mid（乐观锁 version；置为 COMPLETED 触发事件） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; mid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-milestone:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "project-milestone.update");

  const { id, mid } = await params;
  const meta = requestMeta(request);
  const parsed = milestoneUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const txResult = await prisma.$transaction(async (tx) => {
    const gate = await assertProjectWritable(tx, id);
    if (!gate.ok) return { error: gate.response };


    const { version, ...updates } = parsed.data;
    const existing = await tx.projectMilestone.findFirst({ where: { id: mid, projectId: id, deletedAt: null } });
    if (!existing) return { error: failNotFound(ERROR_CODES.NOT_FOUND, "里程碑不存在") };
    if (existing.version !== version) {
      return { error: failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试") };
    }

  const updated = await tx.projectMilestone.update({
    where: { id: mid },
    data: {
      ...updates,
      status: updates.status as MilestoneStatus | undefined,
      plannedDate: updates.plannedDate === undefined ? undefined : updates.plannedDate === null ? null : new Date(updates.plannedDate),
      actualDate: updates.actualDate === undefined ? undefined : updates.actualDate === null ? null : new Date(updates.actualDate),
      version: { increment: 1 },
      updatedById: user!.id,
    },
  });
    return { updated, existing };
  });
  if ("error" in txResult) return txResult.error;
  const { updated, existing } = txResult;

  await writeAuditLog({
    actorId: user?.id,
    action: "project-milestone.update",
    entityType: "projectMilestone",
    entityId: mid,
    beforeData: { name: existing.name, status: existing.status },
    afterData: { name: updated.name, status: updated.status },
    ...meta,
  });

  // Domain Event：ProjectMilestoneCompleted（当更新后 status=COMPLETED）

  return ok(updated);
}

/** DELETE /api/projects/:id/milestones/:mid（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; mid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-milestone:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "project-milestone.delete");

  const { id, mid } = await params;
  const meta = requestMeta(request);

  const txResult = await prisma.$transaction(async (tx) => {
    const gate = await assertProjectWritable(tx, id);
    if (!gate.ok) return { error: gate.response };

    const existing = await tx.projectMilestone.findFirst({ where: { id: mid, projectId: id, deletedAt: null } });
    if (!existing) return { error: failNotFound(ERROR_CODES.NOT_FOUND, "里程碑不存在") };

  await tx.projectMilestone.update({
    where: { id: mid },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });
    return { ok: true };
  });
  if ("error" in txResult) return txResult.error;

  await writeAuditLog({
    actorId: user?.id,
    action: "project-milestone.delete",
    entityType: "projectMilestone",
    entityId: mid,
    ...meta,
  });

  return ok({ id: mid, deleted: true });
}
