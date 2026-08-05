import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const contactUpdateSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    title: z.string().max(100).nullable().optional(),
    department: z.string().max(100).nullable().optional(),
    phone: z.string().max(30).nullable().optional(),
    email: z.string().email().nullable().optional(),
    wechat: z.string().max(100).nullable().optional(),
    isPrimary: z.boolean().optional(),
    sort: z.number().int().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** PATCH /api/customers/:id/contacts/:contactId（乐观锁；isPrimary 时清除其他主联系人） */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-contact:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-contact.update");

  const { id, contactId } = await params;
  const meta = requestMeta(request);
  const parsed = contactUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.customerContact.findFirst({
    where: { id: contactId, customerId: id, deletedAt: null },
  });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "联系人不存在");
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (updates.isPrimary === true) {
      await tx.customerContact.updateMany({
        where: { customerId: id, deletedAt: null, id: { not: contactId } },
        data: { isPrimary: false, updatedById: user?.id ?? null },
      });
    }
    return tx.customerContact.update({
      where: { id: contactId },
      data: { ...updates, version: { increment: 1 }, updatedById: user!.id },
    });
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "customer-contact.update",
    entityType: "customer-contact",
    entityId: contactId,
    beforeData: { name: existing.name, isPrimary: existing.isPrimary },
    afterData: { name: updated.name, isPrimary: updated.isPrimary },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/customers/:id/contacts/:contactId（软删除） */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-contact:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-contact.delete");

  const { id, contactId } = await params;
  const meta = requestMeta(request);

  const result = await prisma.customerContact.updateMany({
    where: { id: contactId, customerId: id, deletedAt: null },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });
  if (result.count === 0) return failNotFound(ERROR_CODES.NOT_FOUND, "联系人不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "customer-contact.delete",
    entityType: "customer-contact",
    entityId: contactId,
    ...meta,
  });

  return ok({ id: contactId, deleted: true });
}
