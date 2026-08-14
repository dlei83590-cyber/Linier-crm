import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { hasPermission, type RoleCode } from "@nilier-crm/shared";
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

/** GET /api/projects/:id（详情；子资源按各自 view 权限条件投影，CTO #12122 aggregate read permission hardening） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project.get");

  const { id } = await params;

  // 子资源能力投影：与独立子资源 API 的 view 权限一致（事实基线见 apps/web/src/app/api/projects/[id]/*/route.ts）
  const roles = (user?.roles ?? []) as RoleCode[];
  const capabilities = {
    stakeholders: hasPermission(roles, "project-stakeholder:view"),
    members: hasPermission(roles, "project-member:view"),
    milestones: hasPermission(roles, "project-milestone:view"),
    tasks: hasPermission(roles, "project-task:view"),
    budgets: hasPermission(roles, "project-budget:view"),
    expenses: hasPermission(roles, "project-expense:view"),
    products: hasPermission(roles, "project-product:view"),
    risks: hasPermission(roles, "project-risk:view"),
    visits: hasPermission(roles, "project-visit:view"),
    progresses: hasPermission(roles, "project-progress:view"),
    acceptances: hasPermission(roles, "project-acceptance:view"),
    closure: hasPermission(roles, "project-closure:view"),
    tags: hasPermission(roles, "project-tag:view"),
  };

  const project = await prisma.project.findFirst({
    where: { id, deletedAt: null },
    include: {
      customer: { select: { id: true, code: true, name: true, type: true } },
      opportunity: { select: { id: true, code: true, name: true, stage: true } },
      ...(capabilities.stakeholders
        ? { stakeholders: { where: { deletedAt: null }, orderBy: [{ role: "asc" }, { createdAt: "asc" }] } }
        : {}),
      ...(capabilities.members
        ? { members: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } } }
        : {}),
      ...(capabilities.milestones
        ? { milestones: { where: { deletedAt: null }, orderBy: [{ plannedDate: "asc" }] } }
        : {}),
      ...(capabilities.tasks
        ? { tasks: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } } }
        : {}),
      ...(capabilities.budgets
        ? { budgets: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } } }
        : {}),
      ...(capabilities.expenses
        ? { expenses: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } } }
        : {}),
      ...(capabilities.products
        ? { products: { where: { deletedAt: null }, include: { item: { select: { id: true, code: true, name: true, model: true } } } } }
        : {}),
      ...(capabilities.risks
        ? { risks: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } } }
        : {}),
      ...(capabilities.visits
        ? { visits: { where: { deletedAt: null }, orderBy: { visitedAt: "desc" } } }
        : {}),
      ...(capabilities.progresses
        ? { progresses: { where: { deletedAt: null }, orderBy: { recordedAt: "desc" } } }
        : {}),
      ...(capabilities.acceptances
        ? { acceptances: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } } }
        : {}),
      ...(capabilities.closure ? { closure: true } : {}),
      ...(capabilities.tags
        ? { tags: { where: { deletedAt: null }, include: { tag: { select: { id: true, code: true, name: true, color: true } } } } }
        : {}),
    },
  });
  if (!project) return failNotFound(ERROR_CODES.NOT_FOUND, "项目不存在");
  return ok({ ...project, capabilities });
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
