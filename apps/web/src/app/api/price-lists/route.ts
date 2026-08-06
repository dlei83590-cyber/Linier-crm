import { NextRequest } from "next/server";
import type { PriceListStatus, PriceType, PriceSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const priceListCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  priceType: z.enum(["PURCHASE", "SALES", "VIP", "AGENT", "ENGINEERING", "STRATEGIC", "REGIONAL", "CUSTOMER", "HISTORICAL"]).optional(),
  currency: z.string().max(10).optional(),
  pricePolicyId: z.string().min(1).nullable().optional(),
  policyType: z.enum(["STANDARD", "VIP", "PROJECT", "DEALER", "REGIONAL", "PROMOTION"]).nullable().optional(),
  baseCurrency: z.string().max(10).optional(),
  quoteCurrency: z.string().max(10).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  effectiveFrom: z.string().datetime().nullable().optional(),
  effectiveTo: z.string().datetime().nullable().optional(),
  validFrom: z.string().datetime().nullable().optional(),
  validTo: z.string().datetime().nullable().optional(),
  priceSource: z.enum(["MANUAL", "IMPORT", "FORMULA", "PROMOTION", "SUPPLIER", "MARKET"]).optional(),
  freightIncluded: z.boolean().optional(),
});

/** GET /api/price-lists（分页 + code/name/status/priceType 过滤，Sprint 3C-4 Price Foundation） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-list:view");
  if (denied) return denied;
  requestLog(request, user?.id, "price-list.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const name = searchParams.get("name")?.trim();
  const status = searchParams.get("status")?.trim();
  const priceType = searchParams.get("priceType")?.trim();
  const pricePolicyId = searchParams.get("pricePolicyId")?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code } } : {}),
    ...(name ? { name: { contains: name } } : {}),
    ...(status ? { status: status as PriceListStatus } : {}),
    ...(priceType ? { priceType: priceType as PriceType } : {}),
    ...(pricePolicyId ? { pricePolicyId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.priceList.count({ where }),
    prisma.priceList.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        policy: { select: { id: true, code: true, name: true, policyType: true } },
        versions: { where: { deletedAt: null }, orderBy: [{ versionNo: "desc" }], take: 1 },
        _count: { select: { items: { where: { deletedAt: null } } } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/price-lists（创建价目表：code 唯一；policyType 快照与 pricePolicyId 双轨） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-list:create");
  if (denied) return denied;
  requestLog(request, user?.id, "price-list.create");

  const meta = requestMeta(request);
  const parsed = priceListCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const existing = await prisma.priceList.findUnique({ where: { code: parsed.data.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "价目表编码已存在");
  }

  if (parsed.data.pricePolicyId) {
    const policy = await prisma.pricePolicy.findFirst({ where: { id: parsed.data.pricePolicyId, deletedAt: null } });
    if (!policy) return failConflict(ERROR_CODES.NOT_FOUND, "关联价格策略不存在");
  }

  const created = await prisma.priceList.create({
    data: {
      code: parsed.data.code,
      name: parsed.data.name,
      priceType: (parsed.data.priceType as PriceType) ?? "SALES",
      currency: parsed.data.currency ?? "CNY",
      pricePolicyId: parsed.data.pricePolicyId ?? null,
      policyType: parsed.data.policyType as never ?? null,
      baseCurrency: parsed.data.baseCurrency ?? "CNY",
      quoteCurrency: parsed.data.quoteCurrency ?? "CNY",
      status: (parsed.data.status as PriceListStatus) ?? "DRAFT",
      effectiveFrom: parsed.data.effectiveFrom ? new Date(parsed.data.effectiveFrom) : null,
      effectiveTo: parsed.data.effectiveTo ? new Date(parsed.data.effectiveTo) : null,
      validFrom: parsed.data.validFrom ? new Date(parsed.data.validFrom) : null,
      validTo: parsed.data.validTo ? new Date(parsed.data.validTo) : null,
      priceSource: (parsed.data.priceSource as PriceSource) ?? "MANUAL",
      freightIncluded: parsed.data.freightIncluded ?? false,
      approvalStatus: "APPROVED",
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "price-list.create",
    entityType: "priceList",
    entityId: created.id,
    afterData: { code: created.code, name: created.name, status: created.status },
    ...meta,
  });

  return ok(created, undefined, 201);
}
