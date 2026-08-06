import { NextRequest } from "next/server";
import type { PromotionType, PriceSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const promotionCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  promotionType: z.enum(["PERCENT", "AMOUNT"]),
  discountValue: z.coerce.number().nonnegative(),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional(),
  priority: z.number().int().min(0).max(9999).optional(),
  stackable: z.boolean().optional(),
  exclusive: z.boolean().optional(),
  priceSource: z.enum(["MANUAL", "IMPORT", "FORMULA", "PROMOTION", "SUPPLIER", "MARKET"]).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "EXPIRED"]).optional(),
});

/** GET /api/promotions（分页 + code/name/status/promotionType 过滤，Sprint 3C-4 Price Foundation） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "promotion:view");
  if (denied) return denied;
  requestLog(request, user?.id, "promotion.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const name = searchParams.get("name")?.trim();
  const status = searchParams.get("status")?.trim();
  const promotionType = searchParams.get("promotionType")?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code } } : {}),
    ...(name ? { name: { contains: name } } : {}),
    ...(status ? { status } : {}),
    ...(promotionType ? { promotionType: promotionType as PromotionType } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.promotionRule.count({ where }),
    prisma.promotionRule.findMany({
      where,
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/promotions（创建促销：code 唯一；PERCENT=折扣%，AMOUNT=固定金额） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "promotion:create");
  if (denied) return denied;
  requestLog(request, user?.id, "promotion.create");

  const meta = requestMeta(request);
  const parsed = promotionCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const existing = await prisma.promotionRule.findUnique({ where: { code: parsed.data.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "促销编码已存在");
  }

  const created = await prisma.promotionRule.create({
    data: {
      code: parsed.data.code,
      name: parsed.data.name,
      promotionType: parsed.data.promotionType as PromotionType,
      discountValue: parsed.data.discountValue,
      startAt: parsed.data.startAt ? new Date(parsed.data.startAt) : null,
      endAt: parsed.data.endAt ? new Date(parsed.data.endAt) : null,
      priority: parsed.data.priority ?? 100,
      stackable: parsed.data.stackable ?? false,
      exclusive: parsed.data.exclusive ?? false,
      priceSource: (parsed.data.priceSource as PriceSource) ?? "PROMOTION",
      status: parsed.data.status ?? "DRAFT",
      approvalStatus: "APPROVED",
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "promotion.create",
    entityType: "promotionRule",
    entityId: created.id,
    afterData: { code: created.code, name: created.name, promotionType: created.promotionType },
    ...meta,
  });

  return ok(created, undefined, 201);
}
