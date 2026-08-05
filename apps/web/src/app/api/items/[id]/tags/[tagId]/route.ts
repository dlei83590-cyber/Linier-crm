import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/** DELETE /api/items/:id/tags/:tagId（移除标签，软删除） */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tagId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-tag:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "item-tag.delete");

  const { id, tagId } = await params;
  const meta = requestMeta(request);

  const result = await prisma.itemTag.updateMany({
    where: { itemId: id, tagId, deletedAt: null },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });
  if (result.count === 0) return failNotFound(ERROR_CODES.NOT_FOUND, "标签关联不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "item-tag.delete",
    entityType: "item-tag",
    entityId: tagId,
    meta: { itemId: id },
    ...meta,
  });

  return ok({ id: tagId, deleted: true });
}
