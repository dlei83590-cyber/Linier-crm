import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const memberCreateSchema = z.object({
  userId: z.string().min(1).nullable().optional(),
  name: z.string().min(1).max(100),
  roleInProject: z.string().max(100).nullable().optional(),
  joinedAt: z.string().datetime().nullable().optional(),
  leftAt: z.string().datetime().nullable().optional(),
});

/** GET /api/projects/:id/members（项目内部成员，与客户关系人分开，Sprint 3C-5） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-member:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-member.list");

  const { id } = await params;
  const project = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!project) return failConflict(ERROR_CODES.NOT_FOUND, "项目不存在");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const name = searchParams.get("name")?.trim();
  const roleInProject = searchParams.get("roleInProject")?.trim();

  const where = {
    projectId: id,
    deletedAt: null,
    ...(name ? { name: { contains: name } } : {}),
    ...(roleInProject ? { roleInProject: { contains: roleInProject } } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.projectMember.count({ where }),
    prisma.projectMember.findMany({ where, orderBy: { createdAt: "asc" }, skip, take }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/projects/:id/members（新增项目成员；触发 ProjectMemberAssigned Domain Event） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-member:create");
  if (denied) return denied;
  requestLog(request, user?.id, "project-member.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = memberCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const project = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!project) return failConflict(ERROR_CODES.NOT_FOUND, "项目不存在");

  const created = await prisma.projectMember.create({
    data: {
      projectId: id,
      userId: parsed.data.userId ?? null,
      name: parsed.data.name,
      roleInProject: parsed.data.roleInProject ?? null,
      joinedAt: parsed.data.joinedAt ? new Date(parsed.data.joinedAt) : null,
      leftAt: parsed.data.leftAt ? new Date(parsed.data.leftAt) : null,
      approvalStatus: "APPROVED",
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "project-member.create",
    entityType: "projectMember",
    entityId: created.id,
    afterData: { projectId: id, name: created.name, roleInProject: created.roleInProject, userId: created.userId },
    ...meta,
  });

  // Domain Event：ProjectMemberAssigned（EVENTS.md 注册；事件总线 Sprint 4 前落地）

  return ok(created, undefined, 201);
}
