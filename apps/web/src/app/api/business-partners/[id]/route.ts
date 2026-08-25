import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import type { PartnerType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, fail, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";
import { validateUscc, normalizeUscc } from "@/lib/tax-invoice";
import { casUpdate } from "@/lib/api/cas";
import { matchCustomerPools } from "@/lib/customer-pool/match";

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
    // 签到范围（Migration 0051）：客户坐标 + 允许半径（米）；三者齐备时签到启用距离 Gate
    latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
    longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
    allowedRadiusMeters: z.number().int().positive().max(100000).nullable().optional(),
    // 协同群（Migration 0055）：channel key（DB 只存 key，webhook/secret 仅在 Server 环境）
    collaborationChannelKey: z.string().max(64).nullable().optional(),
    isActive: z.boolean().optional(),
    // 开票资料（ADR-0043，I1：uscc GB 32100-2015 校验；I10：maker-checker 走 approvalStatus）
    taxInvoiceInfo: z
      .object({
        title: z.string().min(1).max(200),
        uscc: z.string().min(1).max(32),
        taxpayerType: z.enum(["GENERAL_VAT_PAYER", "SMALL_SCALE"]).optional(),
        registeredAddress: z.string().max(500).nullable().optional(),
        registeredPhone: z.string().max(50).nullable().optional(),
        bankName: z.string().max(100).nullable().optional(),
        bankAccountNo: z.string().max(100).nullable().optional(),
      })
      .nullable()
      .optional(),
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
      invoiceInfoRecord: true, // 开票资料（ADR-0043；F3 前端接线）
      // P-1A Customer 360 Workspace 只读聚合（复用 PartnerContact/Address/Credit/Tag 权威模型，不复制业务字段）
      partnerContacts: { where: { deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { sort: "asc" }] },
      partnerAddresses: { where: { deletedAt: null }, orderBy: [{ isDefault: "desc" }, { sort: "asc" }] },
      partnerTags: { where: { deletedAt: null }, include: { tag: { select: { id: true, code: true, name: true, color: true } } } },
      partnerCredit: true,
      // 供应商档案（Supplier 角色扩展 1:1，Sprint 3C-2）：结算条款/资质只读聚合（供应商 = BusinessPartner type SUPPLIER/BOTH）
      suppliers: {
        where: { deletedAt: null },
        include: {
          settlements: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
          qualifications: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
        },
      },
      // 供应物料关系（SupplierItem.supplierId → BusinessPartner，Sprint 3C-2/3C-3）：供应商-物料关联只读聚合
      supplierItems: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: {
          item: { select: { id: true, code: true, name: true, spec: true, model: true, brand: true } },
        },
      },
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

  // 开票资料（ADR-0043）：uscc GB 32100-2015 校验（I1）——拒绝非法，fail closed
  const { taxInvoiceInfo, ...partnerUpdates } = updates;
  if (taxInvoiceInfo !== undefined && taxInvoiceInfo !== null) {
    if (!validateUscc(taxInvoiceInfo.uscc)) {
      return fail(ERROR_CODES.USCC_INVALID, "统一社会信用代码非法（GB 32100-2015，18 位含校验码）", 400, { uscc: taxInvoiceInfo.uscc });
    }
  }

  let updated: Awaited<ReturnType<typeof prisma.businessPartner.findFirst>>;
  try {
  updated = await prisma.$transaction(async (tx) => {
    // 原子乐观锁（审计 P1：updateMany where {id,version} + count 判定，消除 read-check-update TOCTOU）
    const cas = await casUpdate(tx, 'businessPartner', id, version, {
      ...partnerUpdates,
      type: partnerUpdates.type as PartnerType | undefined,
      invoiceInfo: partnerUpdates.invoiceInfo === undefined ? undefined : partnerUpdates.invoiceInfo === null ? Prisma.JsonNull : (partnerUpdates.invoiceInfo as Prisma.InputJsonValue),
      tags: partnerUpdates.tags === undefined ? undefined : partnerUpdates.tags === null ? Prisma.JsonNull : (partnerUpdates.tags as Prisma.InputJsonValue),
      foundedDate: partnerUpdates.foundedDate === undefined ? undefined : partnerUpdates.foundedDate === null ? null : new Date(partnerUpdates.foundedDate),
      updatedById: user?.id ?? null,
    });
    if (cas.outcome === 'NOT_FOUND') throw new Error('NOT_FOUND');
    if (cas.outcome === 'CONFLICT') throw new Error('VERSION_CONFLICT');
    const saved = await tx.businessPartner.findFirst({ where: { id, deletedAt: null } });
    if (!saved) throw new Error('NOT_FOUND');
    // 开票资料 upsert（1:1；变更走 approvalStatus=DRAFT，由 BusinessPartner 审批投影治理，I10）
    if (taxInvoiceInfo !== undefined && taxInvoiceInfo !== null) {
      await tx.businessPartnerInvoiceInfo.upsert({
        where: { partnerId: id },
        create: {
          partnerId: id,
          title: taxInvoiceInfo.title,
          uscc: normalizeUscc(taxInvoiceInfo.uscc),
          taxpayerType: taxInvoiceInfo.taxpayerType ?? "GENERAL_VAT_PAYER",
          registeredAddress: taxInvoiceInfo.registeredAddress ?? null,
          registeredPhone: taxInvoiceInfo.registeredPhone ?? null,
          bankName: taxInvoiceInfo.bankName ?? null,
          bankAccountNo: taxInvoiceInfo.bankAccountNo ?? null,
          approvalStatus: "DRAFT",
          createdById: user?.id ?? null,
          updatedById: user?.id ?? null,
        },
        update: {
          title: taxInvoiceInfo.title,
          uscc: normalizeUscc(taxInvoiceInfo.uscc),
          taxpayerType: taxInvoiceInfo.taxpayerType ?? "GENERAL_VAT_PAYER",
          registeredAddress: taxInvoiceInfo.registeredAddress ?? null,
          registeredPhone: taxInvoiceInfo.registeredPhone ?? null,
          bankName: taxInvoiceInfo.bankName ?? null,
          bankAccountNo: taxInvoiceInfo.bankAccountNo ?? null,
          approvalStatus: "DRAFT",
          updatedById: user?.id ?? null,
          version: { increment: 1 },
        },
      });
    }
    return saved;
  });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, '往来单位不存在');
    if (msg === 'VERSION_CONFLICT') return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试');
    throw e;
  }

  await writeAuditLog({
    actorId: user?.id,
    action: "business-partner.update",
    entityType: "businessPartner",
    entityId: id,
    beforeData: { code: existing.code, name: existing.name },
    afterData: { code: updated.code, name: updated.name },
    ...meta,
  });

  // 客户公海自动匹配（合同「触碰规则客户自动流入公海」；MVP REGION scope；best-effort 不回滚主档）
  await matchCustomerPools(updated.id).catch((err) => {
    console.error("[customer-pool] matchCustomerPools best-effort 失败（不影响 BP 主档）:", err);
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

  const existing = await prisma.businessPartner.findFirst({
    where: { id, deletedAt: null },
    include: {
      _count: {
        select: {
          suppliers: true,
          customers: true,
          opportunities: true,
          projects: true,
          partnerContacts: true,
          partnerAddresses: true,
          partnerBankAccounts: true,
        },
      },
    },
  });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "往来单位不存在");

  // 引用检查：被客户/供应商/项目/联系人等引用 → 不可删除（可编辑）
  const referenced =
    existing._count.suppliers +
    existing._count.customers +
    existing._count.opportunities +
    existing._count.projects +
    existing._count.partnerContacts +
    existing._count.partnerAddresses +
    existing._count.partnerBankAccounts;
  if (referenced > 0) {
    return failConflict(ERROR_CODES.CONFLICT, "往来单位已被客户/供应商/项目等引用，不能删除（可编辑）");
  }

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