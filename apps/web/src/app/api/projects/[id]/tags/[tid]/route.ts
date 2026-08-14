import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog, assertProjectWritable } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/** DELETE /api/projects/:id/tags/:tid（解绑标签，软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; tid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-tag:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "project-tag.delete");

  const { id, tid } = await params;
  const meta = requestMeta(request);
  const writableErr = await assertProjectWritable(id);
  if (writableErr) return writableErr;

  const existing = await prisma.projectTag.findFirst({ where: { id: tid, projectId: id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "项目标签绑定不存在");

  await prisma.projectTag.update({
    where: { id: tid },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "project-tag.delete",
    entityType: "projectTag",
    entityId: tid,
    ...meta,
  });

  return ok({ id: tid, deleted: true });
}
