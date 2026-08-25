import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/** DELETE /api/business-partners/:id/suppliers/:relationId（解除客户供应商关联；软删除；business-partner:edit） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; relationId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "business-partner:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-supplier.delete");

  const { id, relationId } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.customerSupplier.findFirst({
    where: { id: relationId, customerId: id, deletedAt: null },
    select: { id: true, supplierId: true },
  });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "供应商关联不存在");

  const now = new Date();
  await prisma.customerSupplier.update({
    where: { id: relationId },
    data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "customer-supplier.delete",
    entityType: "customerSupplier",
    entityId: relationId,
    beforeData: { customerId: id, supplierId: existing.supplierId },
    ...meta,
  });

  return ok({ id: relationId, deleted: true });
}
