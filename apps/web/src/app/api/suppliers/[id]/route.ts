import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const supplierUpdateSchema = z
  .object({
    code: z.string().min(1).max(64).optional(),
    name: z.string().min(1).max(200).optional(),
    partnerId: z.string().min(1).optional(),
    status: z.enum(["POTENTIAL", "QUALIFIED", "PREFERRED", "SUSPENDED", "BLACKLISTED"]).optional(),
    rating: z.number().int().min(1).max(5).nullable().optional(),
    defaultLeadTime: z.number().int().positive().nullable().optional(),
    minOrderQty: z.coerce.number().nonnegative().nullable().optional(),
    currency: z.string().max(10).optional(),
    isPreferred: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/suppliers/:id（详情含 BP + 子资源计数） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "supplier:view");
  if (denied) return denied;
  requestLog(request, user?.id, "supplier.get");

  const { id } = await params;
  const supplier = await prisma.supplier.findFirst({
    where: { id, deletedAt: null },
    include: {
      partner: { select: { id: true, code: true, name: true, uscc: true, type: true, taxpayerType: true, legalRepresentative: true, registeredAddress: true, bankName: true, bankAccount: true, settlementTerms: true, region: true, industry: true, companySize: true, website: true } },
      qualifications: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
      certificates: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
      settlements: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!supplier) return failNotFound(ERROR_CODES.NOT_FOUND, "供应商不存在");
  return ok(supplier);
}

/** PATCH /api/suppliers/:id（乐观锁 version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "supplier:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "supplier.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = supplierUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.supplier.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "供应商不存在");
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  if (updates.partnerId && updates.partnerId !== existing.partnerId) {
    const partner = await prisma.businessPartner.findFirst({ where: { id: updates.partnerId, deletedAt: null } });
    if (!partner) return failConflict(ERROR_CODES.NOT_FOUND, "关联往来单位不存在");
    if (partner.type === "CUSTOMER") {
      return failConflict(ERROR_CODES.CONFLICT, "该往来单位类型为 CUSTOMER，不能作为供应商");
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (updates.partnerId && updates.partnerId !== existing.partnerId) {
      await tx.businessPartnerRole.upsert({
        where: { partnerId_roleType: { partnerId: updates.partnerId!, roleType: "SUPPLIER" } },
        update: {},
        create: { partnerId: updates.partnerId!, roleType: "SUPPLIER", createdById: user!.id, updatedById: user!.id },
      });
    }
    return tx.supplier.update({
      where: { id },
      data: {
        ...updates,
        minOrderQty: updates.minOrderQty === undefined ? undefined : updates.minOrderQty,
        version: { increment: 1 },
        updatedById: user!.id,
      },
    });
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "supplier.update",
    entityType: "supplier",
    entityId: id,
    beforeData: { name: existing.name, status: existing.status },
    afterData: { name: updated.name, status: updated.status },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/suppliers/:id（软删除，含子资源级联标记） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "supplier:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "supplier.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const result = await prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({ where: { id, deletedAt: null } });
    if (!supplier) return null;
    const now = new Date();
    await tx.supplierQualification.updateMany({ where: { supplierId: id, deletedAt: null }, data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null } });
    await tx.supplierCertificate.updateMany({ where: { supplierId: id, deletedAt: null }, data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null } });
    await tx.supplierSettlement.updateMany({ where: { supplierId: id, deletedAt: null }, data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null } });
    await tx.supplier.update({ where: { id }, data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null } });
    return { id };
  });

  if (!result) return failNotFound(ERROR_CODES.NOT_FOUND, "供应商不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "supplier.delete",
    entityType: "supplier",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
