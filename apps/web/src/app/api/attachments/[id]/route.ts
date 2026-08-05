import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/** DELETE /api/attachments/:id（解除挂载，软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "file-attachment:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "file-attachment.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const result = await prisma.fileAttachment.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });
  if (result.count === 0) return failNotFound(ERROR_CODES.NOT_FOUND, "附件关联不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "file-attachment.delete",
    entityType: "file-attachment",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
