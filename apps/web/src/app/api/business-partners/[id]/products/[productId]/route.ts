import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/** DELETE /api/business-partners/:id/products/:productId（解除客户产品关联；软删除；business-partner:edit） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; productId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "business-partner:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-product.delete");

  const { id, productId } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.customerProduct.findFirst({
    where: { id: productId, businessPartnerId: id, deletedAt: null },
    select: { id: true, itemId: true },
  });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "产品关联不存在");

  const now = new Date();
  await prisma.customerProduct.update({
    where: { id: productId },
    data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "customer-product.delete",
    entityType: "customerProduct",
    entityId: productId,
    beforeData: { businessPartnerId: id, itemId: existing.itemId },
    ...meta,
  });

  return ok({ id: productId, deleted: true });
}
