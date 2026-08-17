import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog, assertProjectWritable } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
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

  // L1-B lifecycle integrity：DELETE 与 Project header lock 同事务（B2-0 锁纪律：Project FOR UPDATE → Gate → mutation）；CLOSED → 409
  const txResult = await prisma.$transaction(async (tx) => {
    const gate = await assertProjectWritable(tx, id);
    if (!gate.ok) return { error: gate.response };

    const existing = await tx.fileAttachment.findFirst({
      where: { id: aid, businessType: "project", businessId: id, deletedAt: null },
    });
    if (!existing) return { error: failNotFound(ERROR_CODES.NOT_FOUND, "项目附件关联不存在") };

    const updated = await tx.fileAttachment.update({
      where: { id: aid },
      data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
    });
    return { updated };
  });
  if ("error" in txResult) return txResult.error;

  await writeAuditLog({
    actorId: user?.id,
    action: "project-attachment.delete",
    entityType: "fileAttachment",
    entityId: aid,
    ...meta,
  });

  return ok({ id: aid, deleted: true });
}
