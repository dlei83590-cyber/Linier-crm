import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const addressUpdateSchema = z
  .object({
    addressType: z.enum(["REGISTERED", "SHIPPING", "INVOICING", "CONTACT"]).optional(),
    recipient: z.string().max(100).nullable().optional(),
    phone: z.string().max(30).nullable().optional(),
    province: z.string().max(50).nullable().optional(),
    city: z.string().max(50).nullable().optional(),
    district: z.string().max(50).nullable().optional(),
    detail: z.string().max(300).nullable().optional(),
    isDefault: z.boolean().optional(),
    sort: z.number().int().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** PATCH /api/customers/:id/addresses/:addressId（乐观锁；isDefault 时清除其他默认地址） */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; addressId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-address:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-address.update");

  const { id, addressId } = await params;
  const meta = requestMeta(request);
  const parsed = addressUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.customerAddress.findFirst({
    where: { id: addressId, customerId: id, deletedAt: null },
  });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "地址不存在");
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (updates.isDefault === true) {
      await tx.customerAddress.updateMany({
        where: { customerId: id, deletedAt: null, id: { not: addressId } },
        data: { isDefault: false, updatedById: user?.id ?? null },
      });
    }
    return tx.customerAddress.update({
      where: { id: addressId },
      data: { ...updates, version: { increment: 1 }, updatedById: user!.id },
    });
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "customer-address.update",
    entityType: "customer-address",
    entityId: addressId,
    beforeData: { addressType: existing.addressType, isDefault: existing.isDefault },
    afterData: { addressType: updated.addressType, isDefault: updated.isDefault },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/customers/:id/addresses/:addressId（软删除） */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; addressId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-address:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-address.delete");

  const { id, addressId } = await params;
  const meta = requestMeta(request);

  const result = await prisma.customerAddress.updateMany({
    where: { id: addressId, customerId: id, deletedAt: null },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });
  if (result.count === 0) return failNotFound(ERROR_CODES.NOT_FOUND, "地址不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "customer-address.delete",
    entityType: "customer-address",
    entityId: addressId,
    ...meta,
  });

  return ok({ id: addressId, deleted: true });
}
