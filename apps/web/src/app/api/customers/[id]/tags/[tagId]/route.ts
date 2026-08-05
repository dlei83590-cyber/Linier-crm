import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/** DELETE /api/customers/:id/tags/:tagId（移除客户标签，软删除） */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tagId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-tag:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-tag.delete");

  const { id, tagId } = await params;
  const meta = requestMeta(request);

  const result = await prisma.customerTag.updateMany({
    where: { customerId: id, tagId, deletedAt: null },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });
  if (result.count === 0) return failNotFound(ERROR_CODES.NOT_FOUND, "客户标签不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "customer-tag.delete",
    entityType: "customer-tag",
    entityId: tagId,
    meta: { customerId: id },
    ...meta,
  });

  return ok({ id: tagId, deleted: true });
}
