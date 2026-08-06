import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/** GET /api/projects/:id/closure（项目结项详情，1:1；结项通过 POST /api/projects/:id/close 执行） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-closure:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-closure.get");

  const { id } = await params;
  const project = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!project) return failConflict(ERROR_CODES.NOT_FOUND, "项目不存在");

  const closure = await prisma.projectClosure.findFirst({ where: { projectId: id, deletedAt: null } });
  if (!closure) return failNotFound(ERROR_CODES.NOT_FOUND, "项目尚未结项");
  return ok(closure);
}

/** DELETE /api/projects/:id/closure（撤销结项记录——仅软删除结项记录，不改变项目阶段；高级操作，需 project-closure:delete） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-closure:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "project-closure.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const closure = await prisma.projectClosure.findFirst({ where: { projectId: id, deletedAt: null } });
  if (!closure) return failNotFound(ERROR_CODES.NOT_FOUND, "项目尚未结项");

  await prisma.projectClosure.update({
    where: { id: closure.id },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "project-closure.delete",
    entityType: "projectClosure",
    entityId: closure.id,
    ...meta,
  });

  return ok({ id: closure.id, deleted: true });
}
