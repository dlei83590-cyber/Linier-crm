import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const projectUpdateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    priority: z.enum(["HIGH", "MEDIUM", "LOW"]).nullable().optional(),
    ownerId: z.string().min(1).nullable().optional(),
    description: z.string().max(1000).nullable().optional(),
    progressPercent: z.coerce.number().min(0).max(100).nullable().optional(),
    projectRating: z.string().max(50).nullable().optional(),
    // 注意：stage 不允许通过 PATCH 修改，必须走 POST /api/projects/:id/transition 集中校验
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/**
 * 结项后禁止修改关键字段（CTO #3C5：结项后锁定）。
 * 实现：PATCH 内先查 ProjectClosure，若已结项直接 409 拒绝全部关键字段更新。
 */

/** GET /api/projects/:id（详情含全部子资源计数与阶段信息） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project.get");

  const { id } = await params;
  const project = await prisma.project.findFirst({
    where: { id, deletedAt: null },
    include: {
      customer: { select: { id: true, code: true, name: true, type: true } },
      opportunity: { select: { id: true, code: true, name: true, stage: true } },
      stakeholders: { where: { deletedAt: null }, orderBy: [{ role: "asc" }, { createdAt: "asc" }] },
      members: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } },
      milestones: { where: { deletedAt: null }, orderBy: [{ plannedDate: "asc" }] },
      tasks: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } },
      budgets: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } },
      expenses: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
      products: { where: { deletedAt: null }, include: { item: { select: { id: true, code: true, name: true, model: true } } } },
      risks: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
      visits: { where: { deletedAt: null }, orderBy: { visitedAt: "desc" } },
      progresses: { where: { deletedAt: null }, orderBy: { recordedAt: "desc" } },
      acceptances: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } },
      closure: true,
      tags: { where: { deletedAt: null }, include: { tag: { select: { id: true, code: true, name: true, color: true } } } },
    },
  });
  if (!project) return failNotFound(ERROR_CODES.NOT_FOUND, "项目不存在");
  return ok(project);
}

/** PATCH /api/projects/:id（乐观锁 version；禁止改 stage/结项锁定字段；转换自机会的项目禁改 customerId） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "project.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = projectUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;
  const existing = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "项目不存在");
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  // 结项后禁止修改关键字段（CTO #3C5）
  const closure = await prisma.projectClosure.findFirst({ where: { projectId: id, deletedAt: null } });
  if (closure) {
    return failConflict(ERROR_CODES.CONFLICT, "项目已结项，禁止修改关键字段");
  }

  const updated = await prisma.project.update({
    where: { id },
    data: {
      ...updates,
      version: { increment: 1 },
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "project.update",
    entityType: "project",
    entityId: id,
    beforeData: { name: existing.name, priority: existing.priority, progressPercent: existing.progressPercent },
    afterData: { name: updated.name, priority: updated.priority, progressPercent: updated.progressPercent },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/projects/:id（软删除；已结项项目禁止删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "project.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "项目不存在");
  const closure = await prisma.projectClosure.findFirst({ where: { projectId: id, deletedAt: null } });
  if (closure) {
    return failConflict(ERROR_CODES.CONFLICT, "项目已结项，禁止删除");
  }

  await prisma.project.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "project.delete",
    entityType: "project",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
