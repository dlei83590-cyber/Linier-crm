import { NextRequest } from "next/server";
import type { TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const taskCreateSchema = z.object({
  milestoneId: z.string().min(1).nullable().optional(),
  name: z.string().min(1).max(200),
  assigneeId: z.string().min(1).nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "DONE", "CANCELLED"]).optional(),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
});

/** GET /api/projects/:id/tasks（项目任务，可挂里程碑，Sprint 3C-5） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-task:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-task.list");

  const { id } = await params;
  const project = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!project) return failConflict(ERROR_CODES.NOT_FOUND, "项目不存在");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const milestoneId = searchParams.get("milestoneId")?.trim();
  const status = searchParams.get("status")?.trim();
  const assigneeId = searchParams.get("assigneeId")?.trim();

  const where = {
    projectId: id,
    deletedAt: null,
    ...(milestoneId ? { milestoneId } : {}),
    ...(status ? { status: status as TaskStatus } : {}),
    ...(assigneeId ? { assigneeId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.projectTask.count({ where }),
    prisma.projectTask.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip,
      take,
      include: { milestone: { select: { id: true, name: true, status: true } } },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/projects/:id/tasks（新增任务） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-task:create");
  if (denied) return denied;
  requestLog(request, user?.id, "project-task.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = taskCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const project = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!project) return failConflict(ERROR_CODES.NOT_FOUND, "项目不存在");

  if (parsed.data.milestoneId) {
    const milestone = await prisma.projectMilestone.findFirst({ where: { id: parsed.data.milestoneId, projectId: id, deletedAt: null } });
    if (!milestone) return failConflict(ERROR_CODES.NOT_FOUND, "关联里程碑不存在或不属于该项目");
  }

  const created = await prisma.projectTask.create({
    data: {
      projectId: id,
      milestoneId: parsed.data.milestoneId ?? null,
      name: parsed.data.name,
      assigneeId: parsed.data.assigneeId ?? null,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      status: (parsed.data.status as TaskStatus) ?? "TODO",
      priority: parsed.data.priority ?? null,
      description: parsed.data.description ?? null,
      approvalStatus: "APPROVED",
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "project-task.create",
    entityType: "projectTask",
    entityId: created.id,
    afterData: { projectId: id, name: created.name, status: created.status, milestoneId: created.milestoneId },
    ...meta,
  });

  return ok(created, undefined, 201);
}
