import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/** DELETE /api/business-partners/:id/attachments/:attachmentId（解除客户文档挂载；软删除；file-attachment:delete） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "file-attachment:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-attachment.delete");

  const { id, attachmentId } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.fileAttachment.findFirst({
    where: { id: attachmentId, businessType: "business-partner", businessId: id, deletedAt: null },
    select: { id: true, fileId: true },
  });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "文档挂载不存在");

  const now = new Date();
  await prisma.fileAttachment.update({
    where: { id: attachmentId },
    data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "customer-attachment.delete",
    entityType: "customerAttachment",
    entityId: attachmentId,
    beforeData: { businessPartnerId: id, fileId: existing.fileId },
    ...meta,
  });

  return ok({ id: attachmentId, deleted: true });
}
