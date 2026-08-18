import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import type { PartnerType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** 统一往来单位主数据（Pending Pages Completion Gate — Batch 1；SSOT = Prisma BusinessPartner） */
const businessPartnerCreateSchema = z.object({
  code: z.string().min(1).max(64),
  mnemonic: z.string().max(64).nullable().optional(),
  name: z.string().min(1).max(200),
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
});

/** GET /api/business-partners（分页 + code/name/mnemonic/type/region/industry/isActive 过滤） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "business-partner:view");
  if (denied) return denied;
  requestLog(request, user?.id, "business-partner.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const name = searchParams.get("name")?.trim();
  const mnemonic = searchParams.get("mnemonic")?.trim();
  const type = searchParams.get("type")?.trim();
  const region = searchParams.get("region")?.trim();
  const industry = searchParams.get("industry")?.trim();
  const isActive = searchParams.get("isActive")?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code, mode: "insensitive" as const } } : {}),
    ...(name ? { name: { contains: name, mode: "insensitive" as const } } : {}),
    ...(mnemonic ? { mnemonic: { contains: mnemonic, mode: "insensitive" as const } } : {}),
    ...(type ? { type: type as PartnerType } : {}),
    ...(region ? { region: { contains: region, mode: "insensitive" as const } } : {}),
    ...(industry ? { industry: { contains: industry, mode: "insensitive" as const } } : {}),
    ...(isActive === "true" ? { isActive: true } : isActive === "false" ? { isActive: false } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.businessPartner.count({ where }),
    prisma.businessPartner.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/business-partners（创建往来单位：code/uscc 唯一；approvalStatus=APPROVED 沿用主数据先例） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "business-partner:create");
  if (denied) return denied;
  requestLog(request, user?.id, "business-partner.create");

  const meta = requestMeta(request);
  const parsed = businessPartnerCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const existing = await prisma.businessPartner.findUnique({ where: { code: parsed.data.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "往来单位编码已存在");
  }
  if (parsed.data.uscc) {
    const usccExisting = await prisma.businessPartner.findUnique({ where: { uscc: parsed.data.uscc } });
    if (usccExisting && !usccExisting.deletedAt) {
      return failConflict(ERROR_CODES.CONFLICT, "统一社会信用代码已存在");
    }
  }

  const created = await prisma.businessPartner.create({
    data: {
      code: parsed.data.code,
      mnemonic: parsed.data.mnemonic ?? null,
      name: parsed.data.name,
      type: (parsed.data.type as PartnerType) ?? "SUPPLIER",
      uscc: parsed.data.uscc ?? null,
      taxpayerType: parsed.data.taxpayerType ?? null,
      legalRepresentative: parsed.data.legalRepresentative ?? null,
      registeredAddress: parsed.data.registeredAddress ?? null,
      invoiceInfo: parsed.data.invoiceInfo === undefined ? undefined : parsed.data.invoiceInfo === null ? Prisma.JsonNull : (parsed.data.invoiceInfo as Prisma.InputJsonValue),
      bankName: parsed.data.bankName ?? null,
      bankAccount: parsed.data.bankAccount ?? null,
      settlementTerms: parsed.data.settlementTerms ?? null,
      shortName: parsed.data.shortName ?? null,
      fullName: parsed.data.fullName ?? null,
      groupName: parsed.data.groupName ?? null,
      region: parsed.data.region ?? null,
      industry: parsed.data.industry ?? null,
      companySize: parsed.data.companySize ?? null,
      creditRating: parsed.data.creditRating ?? null,
      sourceChannel: parsed.data.sourceChannel ?? null,
      foundedDate: parsed.data.foundedDate ? new Date(parsed.data.foundedDate) : null,
      registeredCapital: parsed.data.registeredCapital ?? null,
      employeeCount: parsed.data.employeeCount ?? null,
      website: parsed.data.website ?? null,
      wechatOfficialAccount: parsed.data.wechatOfficialAccount ?? null,
      tags: parsed.data.tags === undefined ? undefined : parsed.data.tags === null ? Prisma.JsonNull : (parsed.data.tags as Prisma.InputJsonValue),
      contactPerson: parsed.data.contactPerson ?? null,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email ?? null,
      address: parsed.data.address ?? null,
      approvalStatus: "APPROVED",
      createdById: user?.id ?? null,
      updatedById: user?.id ?? null,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "business-partner.create",
    entityType: "businessPartner",
    entityId: created.id,
    afterData: { code: created.code, name: created.name, type: created.type },
    ...meta,
  });

  return ok(created, undefined, 201);
}