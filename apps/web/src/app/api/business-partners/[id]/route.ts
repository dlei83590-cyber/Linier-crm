import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import type { PartnerType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const businessPartnerUpdateSchema = z
  .object({
    code: z.string().min(1).max(64).optional(),
    mnemonic: z.string().max(64).nullable().optional(),
    name: z.string().min(1).max(200).optional(),
    type: z.enum(["CUSTOMER", "SUPPLIER", "BOTH"]).optional(),
    uscc: z.string().max(32).nullable().optional(),
    taxpayerType: z.string().max(64).nullable().optional(),
    legalRepresentative: z.string().max(100).nullable().optional(),
    registeredAddress: z.string().max(500).nullable().optional(),
    invoiceInfo: z.record(z.string(), z.unknown()).nullable().optional(),
    bankName: z.string().max(100).nullable().optional(),
    bankAccount: z.string().max(100).nullable().optional(),
    settlementTerms: z.string().max(500).nullable().optional(),
    shortName: z.string().max(200).nullable().optional(),
    fullName: z.string().max(200).nullable().optional(),
    groupName: z.string().max(200).nullable().optional(),
    region: z.string().max(100).nullable().optional(),
    industry: z.string().max(100).nullable().optional(),
    companySize: z.string().max(100).nullable().optional(),
    creditRating: z.string().max(100).nullable().optional(),
    sourceChannel: z.string().max(100).nullable().optional(),
    foundedDate: z.string().datetime().nullable().optional(),
    registeredCapital: z.string().nullable().optional(),
    employeeCount: z.number().int().nonnegative().nullable().optional(),
    website: z.string().max(300).nullable().optional(),
    wechatOfficialAccount: z.string().max(300).nullable().optional(),
    tags: z.record(z.string(), z.unknown()).nullable().optional(),
    contactPerson: z.string().max(100).nullable().optional(),
    phone: z.string().max(50).nullable().optional(),
    email: z.string().max(200).nullable().optional(),
    address: z.string().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/business-partners/:id（详情，含 BusinessPartnerRole 摘要） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "business-partner:view");
  if (denied) return denied;
  requestLog(request, user?.id, "business-partner.get");

  const { id } = await params;
  const partner = await prisma.businessPartner.findFirst({
    where: { id, deletedAt: null },
    include: {
      roles: { where: { deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
    },
  });
  if (!partner) return failNotFound(ERROR_CODES.NOT_FOUND, "往来单位不存在");
  return ok(partner);
}

/** PATCH /api/business-partners/:id（乐观锁 version；uscc/code 唯一冲突 409） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "business-partner:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "business-partner.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = businessPartnerUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;
  const existing = await prisma.businessPartner.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "往来单位不存在");
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  if (updates.code) {
    const codeExisting = await prisma.businessPartner.findUnique({ where: { code: updates.code } });
    if (codeExisting && codeExisting.id !== id && !codeExisting.deletedAt) {
      return failConflict(ERROR_CODES.CONFLICT, "往来单位编码已存在");
    }
  }
  // 中文化校验（GB 32100-2015）：18 位大写字母/数字（不含 I/O/S/V/Z），服务端归一化大写
  if (updates.uscc) {
    const usccNormalized = updates.uscc.toUpperCase();
    if (!/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(usccNormalized)) {
      return failValidation({ uscc: "统一社会信用代码须为 18 位（GB 32100-2015，不含 I/O/S/V/Z）" });
    }
    updates.uscc = usccNormalized;
    const usccExisting = await prisma.businessPartner.findUnique({ where: { uscc: usccNormalized } });
    if (usccExisting && usccExisting.id !== id && !usccExisting.deletedAt) {
      return failConflict(ERROR_CODES.CONFLICT, "统一社会信用代码已存在");
    }
  }

  const updated = await prisma.businessPartner.update({
    where: { id },
    data: {
      ...updates,
      type: updates.type as PartnerType | undefined,
      invoiceInfo: updates.invoiceInfo === undefined ? undefined : updates.invoiceInfo === null ? Prisma.JsonNull : (updates.invoiceInfo as Prisma.InputJsonValue),
      tags: updates.tags === undefined ? undefined : updates.tags === null ? Prisma.JsonNull : (updates.tags as Prisma.InputJsonValue),
      foundedDate: updates.foundedDate === undefined ? undefined : updates.foundedDate === null ? null : new Date(updates.foundedDate),
      version: { increment: 1 },
      updatedById: user?.id ?? null,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "business-partner.update",
    entityType: "businessPartner",
    entityId: id,
    beforeData: { code: existing.code, name: existing.name },
    afterData: { code: updated.code, name: updated.name },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/business-partners/:id（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "business-partner:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "business-partner.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.businessPartner.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "往来单位不存在");

  await prisma.businessPartner.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "business-partner.delete",
    entityType: "businessPartner",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}