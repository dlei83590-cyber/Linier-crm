import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import type { PartnerType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, fail, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { handleServerError } from "@/lib/api/server-error";
import { normalizeUscc, isValidUscc } from "@/lib/business-partner/normalize";
import { findBusinessPartnerDuplicates } from "@/lib/business-partner/duplicate-check";
import { matchCustomerPools } from "@/lib/customer-pool/match";
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
  // 签到范围（Migration 0051）：客户坐标 + 允许半径（米）；三者齐备时签到启用距离 Gate
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  allowedRadiusMeters: z.number().int().positive().max(100000).nullable().optional(),
  // 协同群（Migration 0055）：channel key（DB 只存 key，webhook/secret 仅在 Server 环境）
  collaborationChannelKey: z.string().max(64).nullable().optional(),
  duplicateAcknowledged: z.boolean().optional(),
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

  // ① USCC：raw → normalizeUscc → GB 32100 校验 → DB 保存 normalized（CTO §B.3；
  //    Preflight 与 Create Guard 语义一致，杜绝 "preflight 允许 913... create 却因空格失败"）
  const usccNormalized = parsed.data.uscc ? normalizeUscc(parsed.data.uscc) : null;
  if (usccNormalized && !isValidUscc(usccNormalized)) {
    return failValidation({ uscc: "统一社会信用代码须为 18 位（GB 32100-2015，不含 I/O/S/V/Z）" });
  }

  // ② Authoritative duplicate guard（与 Preflight 共用同一 matcher，禁止两套规则；不信任前端）
  const dup = await findBusinessPartnerDuplicates({
    name: parsed.data.name,
    uscc: usccNormalized ?? undefined,
    phone: parsed.data.phone ?? undefined,
  });

  if (dup.duplicateLevel === "EXACT") {
    // EXACT 永远 409，acknowledgement 不能绕过（CTO §B.1）
    await writeAuditLog({
      actorId: user?.id,
      action: "business-partner.duplicate-blocked",
      entityType: "businessPartner",
      afterData: {
        duplicateLevel: "EXACT",
        matchedPartnerIds: dup.matches.map((m) => m.id),
        matchReasons: [...new Set(dup.matches.flatMap((m) => m.matchReasons))],
      },
      result: "FAILURE",
      ...meta,
    });
    const deletedHit = dup.matches.some((m) => m.matchReasons.includes("USCC_EXACT_DELETED"));
    return fail(
      ERROR_CODES.DUPLICATE_EXACT,
      deletedHit
        ? "已存在已归档/删除的同一主体（USCC 一致），请恢复或处理原主体，不能重复新建"
        : "已存在相同统一社会信用代码的主体，禁止重复创建",
      409,
      { duplicateLevel: "EXACT", matches: dup.matches },
    );
  }

  if (dup.duplicateLevel === "POTENTIAL" && !parsed.data.duplicateAcknowledged) {
    // POTENTIAL 未显式确认 → 409（CTO §B.1 锁定：未 duplicateAcknowledged=true 不允许创建）
    return fail(
      ERROR_CODES.DUPLICATE_REQUIRES_ACK,
      "已存在疑似重复的往来单位，需确认后继续创建",
      409,
      { duplicateLevel: "POTENTIAL", matches: dup.matches },
    );
  }

  if (dup.duplicateLevel === "POTENTIAL" && parsed.data.duplicateAcknowledged) {
    // 用户显式确认 → 允许创建 + Audit（request-level control，不持久化字段）
    await writeAuditLog({
      actorId: user?.id,
      action: "business-partner.duplicate-acknowledged",
      entityType: "businessPartner",
      afterData: {
        duplicateLevel: "POTENTIAL",
        matchedPartnerIds: dup.matches.map((m) => m.id),
        matchReasons: [...new Set(dup.matches.flatMap((m) => m.matchReasons))],
      },
      ...meta,
    });
  }

  let created: Awaited<ReturnType<typeof prisma.businessPartner.create>> | undefined;
  try {
    created = await prisma.businessPartner.create({
      data: {
        code: parsed.data.code,
        mnemonic: parsed.data.mnemonic ?? null,
        name: parsed.data.name,
        type: (parsed.data.type as PartnerType) ?? "SUPPLIER",
        uscc: usccNormalized,
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
        latitude: parsed.data.latitude ?? null,
        longitude: parsed.data.longitude ?? null,
        allowedRadiusMeters: parsed.data.allowedRadiusMeters ?? null,
        collaborationChannelKey: parsed.data.collaborationChannelKey ?? null,
        approvalStatus: "APPROVED",
        createdById: user?.id ?? null,
        updatedById: user?.id ?? null,
      },
    });
  } catch (err) {
    // ③ P2002 Race Safety（CTO §D）：并发下 precheck 可能同时通过 → 按 target 区分语义
    //    uscc → DUPLICATE_EXACT；code → 既有 code conflict；其他唯一约束 → 统一错误处理
    if (err !== null && typeof err === "object" && (err as { code?: unknown }).code === "P2002") {
      const target = (err as { meta?: { target?: string | string[] } }).meta?.target;
      const targets = Array.isArray(target) ? target : target ? [target] : [];
      if (targets.includes("uscc")) {
        await writeAuditLog({
          actorId: user?.id,
          action: "business-partner.duplicate-blocked",
          entityType: "businessPartner",
          afterData: {
            duplicateLevel: "EXACT",
            matchedPartnerIds: [],
            matchReasons: ["USCC_EXACT"],
            note: "concurrent-race-p2002",
          },
          result: "FAILURE",
          ...meta,
        });
        return failConflict(ERROR_CODES.DUPLICATE_EXACT, "统一社会信用代码已被占用（并发提交）");
      }
      if (targets.includes("code")) {
        return failConflict(ERROR_CODES.CONFLICT, "往来单位编码已存在");
      }
      return handleServerError(request, user?.id, "business-partner.create", err);
    }
    return handleServerError(request, user?.id, "business-partner.create", err);
  }

  await writeAuditLog({
    actorId: user?.id,
    action: "business-partner.create",
    entityType: "businessPartner",
    entityId: created?.id,
    afterData: { code: created?.code, name: created?.name, type: created?.type },
    ...meta,
  });

  // 客户公海自动匹配（合同「触碰规则客户自动流入公海」；MVP REGION scope；best-effort 不回滚主档）
  if (created) {
    await matchCustomerPools(created.id).catch((err) => {
      console.error("[customer-pool] matchCustomerPools best-effort 失败（不影响 BP 主档）:", err);
    });
  }

  return ok(created, undefined, 201);
}
