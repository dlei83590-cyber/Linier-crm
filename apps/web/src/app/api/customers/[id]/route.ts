import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const customerUpdateSchema = z
  .object({
    code: z.string().min(1).max(64).optional(),
    name: z.string().min(1).max(200).optional(),
    shortName: z.string().max(100).nullable().optional(),
    partnerId: z.string().min(1).nullable().optional(),
    level: z.enum(["VIP", "KEY", "REGULAR", "PROSPECT"]).optional(),
    industryId: z.string().min(1).nullable().optional(),
    region: z.string().max(50).nullable().optional(),
    sourceChannel: z.string().max(50).nullable().optional(),
    companySize: z.string().max(50).nullable().optional(),
    foundedDate: z.string().datetime().nullable().optional(),
    website: z.string().max(200).nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/customers/:id（详情含联系人/地址/标签/信用） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer:view");
  if (denied) return denied;
  requestLog(request, user?.id, "customer.get");

  const { id } = await params;
  const customer = await prisma.customer.findFirst({
    where: { id, deletedAt: null },
    include: {
      industry: { select: { id: true, code: true, name: true } },
      contacts: { where: { deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { sort: "asc" }] },
      addresses: { where: { deletedAt: null }, orderBy: [{ isDefault: "desc" }, { sort: "asc" }] },
      tags: { where: { deletedAt: null }, include: { tag: { select: { id: true, code: true, name: true, color: true } } } },
      credit: true,
    },
  });
  if (!customer) return failNotFound(ERROR_CODES.NOT_FOUND, "客户不存在");
  return ok(customer);
}

/** PATCH /api/customers/:id（乐观锁 version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "customer.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = customerUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.customer.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "客户不存在");
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const updated = await prisma.customer.update({
    where: { id },
    data: {
      ...updates,
      foundedDate: updates.foundedDate === undefined ? undefined : updates.foundedDate === null ? null : new Date(updates.foundedDate),
      version: { increment: 1 },
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "customer.update",
    entityType: "customer",
    entityId: id,
    beforeData: { name: existing.name, level: existing.level },
    afterData: { name: updated.name, level: updated.level },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/customers/:id（软删除，含子资源级联标记） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "customer.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const result = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id, deletedAt: null } });
    if (!customer) return null;
    const now = new Date();
    await tx.customerContact.updateMany({ where: { customerId: id, deletedAt: null }, data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null } });
    await tx.customerAddress.updateMany({ where: { customerId: id, deletedAt: null }, data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null } });
    await tx.customerTag.updateMany({ where: { customerId: id, deletedAt: null }, data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null } });
    await tx.customerCredit.updateMany({ where: { customerId: id, deletedAt: null }, data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null } });
    await tx.customer.update({ where: { id }, data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null } });
    return { id };
  });

  if (!result) return failNotFound(ERROR_CODES.NOT_FOUND, "客户不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "customer.delete",
    entityType: "customer",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
