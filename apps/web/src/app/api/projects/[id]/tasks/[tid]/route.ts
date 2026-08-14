import { NextRequest } from "next/server";
import type { TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog, assertProjectWritable } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const taskUpdateSchema = z
  .object({
    milestoneId: z.string().min(1).nullable().optional(),
    name: z.string().min(1).max(200).optional(),
    assigneeId: z.string().min(1).nullable().optional(),
    dueDate: z.string().datetime().nullable().optional(),
    status: z.enum(["TODO", "IN_PROGRESS", "DONE", "CANCELLED"]).optional(),
    priority: z.enum(["HIGH", "MEDIUM", "LOW"]).nullable().optional(),
    description: z.string().max(1000).nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/projects/:id/tasks/:tid（任务详情） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; tid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-task:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-task.get");

  const { id, tid } = await params;
  const item = await prisma.projectTask.findFirst({
    where: { id: tid, projectId: id, deletedAt: null },
  });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "任务不存在");
  return ok(item);
}

/** PATCH /api/projects/:id/tasks/:tid（乐观锁 version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; tid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-task:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "project-task.update");

  const { id, tid } = await params;
  const meta = requestMeta(request);
  const writableErr = await assertProjectWritable(id);
  if (writableErr) return writableErr;
  const parsed = taskUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;
  const existing = await prisma.projectTask.findFirst({ where: { id: tid, projectId: id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "任务不存在");
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  if (updates.milestoneId) {
    const milestone = await prisma.projectMilestone.findFirst({ where: { id: updates.milestoneId, projectId: id, deletedAt: null } });
    if (!milestone) return failConflict(ERROR_CODES.NOT_FOUND, "关联里程碑不存在或不属于该项目");
  }

  const updated = await prisma.projectTask.update({
    where: { id: tid },
    data: {
      ...updates,
      status: updates.status as TaskStatus | undefined,
      dueDate: updates.dueDate === undefined ? undefined : updates.dueDate === null ? null : new Date(updates.dueDate),
      version: { increment: 1 },
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "project-task.update",
    entityType: "projectTask",
    entityId: tid,
    beforeData: { name: existing.name, status: existing.status },
    afterData: { name: updated.name, status: updated.status },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/projects/:id/tasks/:tid（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; tid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-task:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "project-task.delete");

  const { id, tid } = await params;
  const meta = requestMeta(request);
  const writableErr = await assertProjectWritable(id);
  if (writableErr) return writableErr;

  const existing = await prisma.projectTask.findFirst({ where: { id: tid, projectId: id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "任务不存在");

  await prisma.projectTask.update({
    where: { id: tid },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "project-task.delete",
    entityType: "projectTask",
    entityId: tid,
    ...meta,
  });

  return ok({ id: tid, deleted: true });
}
