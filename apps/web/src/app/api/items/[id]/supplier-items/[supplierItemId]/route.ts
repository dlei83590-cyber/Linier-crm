import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const supplierItemUpdateSchema = z
  .object({
    supplierCode: z.string().max(100).nullable().optional(),
    moq: z.coerce.number().nonnegative().nullable().optional(),
    leadTime: z.number().int().positive().nullable().optional(),
    currency: z.string().max(10).optional(),
    purchasePrice: z.coerce.number().nonnegative().nullable().optional(),
    isPreferred: z.boolean().optional(),
    incoterm: z.string().max(20).nullable().optional(),
    paymentTerm: z.string().max(50).nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** PATCH /api/items/:id/supplier-items/:supplierItemId（乐观锁；isPreferred 唯一） */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; supplierItemId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-supplier:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "item-supplier.update");

  const { id, supplierItemId } = await params;
  const meta = requestMeta(request);
  const parsed = supplierItemUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.supplierItem.findFirst({
    where: { id: supplierItemId, itemId: id, deletedAt: null },
  });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "供应商关联不存在");
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (updates.isPreferred === true) {
      await tx.supplierItem.updateMany({
        where: { itemId: id, deletedAt: null, id: { not: supplierItemId } },
        data: { isPreferred: false, updatedById: user?.id ?? null },
      });
    }
    return tx.supplierItem.update({
      where: { id: supplierItemId },
      data: { ...updates, version: { increment: 1 }, updatedById: user!.id },
    });
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "item-supplier.update",
    entityType: "item-supplier",
    entityId: supplierItemId,
    beforeData: { purchasePrice: existing.purchasePrice, isPreferred: existing.isPreferred },
    afterData: { purchasePrice: updated.purchasePrice, isPreferred: updated.isPreferred },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/items/:id/supplier-items/:supplierItemId（软删除） */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; supplierItemId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-supplier:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "item-supplier.delete");

  const { id, supplierItemId } = await params;
  const meta = requestMeta(request);

  const result = await prisma.supplierItem.updateMany({
    where: { id: supplierItemId, itemId: id, deletedAt: null },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });
  if (result.count === 0) return failNotFound(ERROR_CODES.NOT_FOUND, "供应商关联不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "item-supplier.delete",
    entityType: "item-supplier",
    entityId: supplierItemId,
    ...meta,
  });

  return ok({ id: supplierItemId, deleted: true });
}
