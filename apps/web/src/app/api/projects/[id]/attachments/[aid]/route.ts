import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/** DELETE /api/projects/:id/attachments/:aid（解绑附件，软删除关联；不删 File Center 实体） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; aid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-attachment:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "project-attachment.delete");

  const { id, aid } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.fileAttachment.findFirst({
    where: { id: aid, businessType: "project", businessId: id, deletedAt: null },
  });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "项目附件关联不存在");

  await prisma.fileAttachment.update({
    where: { id: aid },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "project-attachment.delete",
    entityType: "fileAttachment",
    entityId: aid,
    ...meta,
  });

  return ok({ id: aid, deleted: true });
}
