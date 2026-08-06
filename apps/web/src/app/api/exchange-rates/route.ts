import { NextRequest } from "next/server";
import type { ExchangeRateType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const exchangeRateCreateSchema = z.object({
  baseCurrency: z.string().min(3).max(10),
  quoteCurrency: z.string().min(3).max(10),
  rate: z.coerce.number().positive(),
  effectiveDate: z.string().datetime(),
  provider: z.string().max(50).nullable().optional(),
  source: z.string().max(50).nullable().optional(),
  rateType: z.enum(["CENTRAL_BANK", "BANK", "MANUAL"]).optional(),
  manualOverride: z.boolean().optional(),
});

/** GET /api/exchange-rates（分页 + baseCurrency/quoteCurrency/rateType 过滤，Sprint 3C-4 Price Foundation） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "exchange-rate:view");
  if (denied) return denied;
  requestLog(request, user?.id, "exchange-rate.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const baseCurrency = searchParams.get("baseCurrency")?.trim();
  const quoteCurrency = searchParams.get("quoteCurrency")?.trim();
  const rateType = searchParams.get("rateType")?.trim();

  const where = {
    deletedAt: null,
    ...(baseCurrency ? { baseCurrency } : {}),
    ...(quoteCurrency ? { quoteCurrency } : {}),
    ...(rateType ? { rateType: rateType as ExchangeRateType } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.exchangeRate.count({ where }),
    prisma.exchangeRate.findMany({
      where,
      orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }],
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/exchange-rates（创建汇率：base+quote+effectiveDate 复合唯一，来源央行/银行/人工） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "exchange-rate:create");
  if (denied) return denied;
  requestLog(request, user?.id, "exchange-rate.create");

  const meta = requestMeta(request);
  const parsed = exchangeRateCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const effectiveDate = new Date(parsed.data.effectiveDate);
  const existing = await prisma.exchangeRate.findUnique({
    where: {
      baseCurrency_quoteCurrency_effectiveDate: {
        baseCurrency: parsed.data.baseCurrency,
        quoteCurrency: parsed.data.quoteCurrency,
        effectiveDate,
      },
    },
  });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "该币种对在有效日期已存在汇率");
  }

  const created = await prisma.exchangeRate.create({
    data: {
      baseCurrency: parsed.data.baseCurrency,
      quoteCurrency: parsed.data.quoteCurrency,
      rate: parsed.data.rate,
      effectiveDate,
      provider: parsed.data.provider ?? null,
      source: parsed.data.source ?? null,
      rateType: (parsed.data.rateType as ExchangeRateType) ?? "MANUAL",
      manualOverride: parsed.data.manualOverride ?? false,
      approvalStatus: "APPROVED",
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "exchange-rate.create",
    entityType: "exchangeRate",
    entityId: created.id,
    afterData: { baseCurrency: created.baseCurrency, quoteCurrency: created.quoteCurrency, rate: created.rate, effectiveDate: created.effectiveDate },
    ...meta,
  });

  return ok(created, undefined, 201);
}
