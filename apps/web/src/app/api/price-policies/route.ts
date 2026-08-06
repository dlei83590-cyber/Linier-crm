import { NextRequest } from "next/server";
import type { PricePolicyType, PriceMatchStrategy } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const pricePolicyCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  policyType: z.enum(["STANDARD", "VIP", "PROJECT", "DEALER", "REGIONAL", "PROMOTION"]),
  priority: z.number().int().min(0).max(9999).optional(),
  matchStrategy: z.enum(["FIRST_MATCH", "BEST_PRICE", "LOWEST_PRICE", "HIGHEST_PRIORITY", "COMBINE"]).optional(),
  stopOnMatch: z.boolean().optional(),
  description: z.string().max(500).nullable().optional(),
});

/** GET /api/price-policies（分页 + code/name/policyType/isActive 过滤，Sprint 3C-4 Price Foundation） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-policy:view");
  if (denied) return denied;
  requestLog(request, user?.id, "price-policy.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const name = searchParams.get("name")?.trim();
  const policyType = searchParams.get("policyType")?.trim();
  const isActive = searchParams.get("isActive")?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code } } : {}),
    ...(name ? { name: { contains: name } } : {}),
    ...(policyType ? { policyType: policyType as PricePolicyType } : {}),
    ...(isActive === "true" ? { isActive: true } : isActive === "false" ? { isActive: false } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.pricePolicy.count({ where }),
    prisma.pricePolicy.findMany({
      where,
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      skip,
      take,
      include: {
        _count: { select: { rules: { where: { deletedAt: null } }, priceLists: { where: { deletedAt: null } } } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/price-policies（创建策略：code 唯一，幂等校验） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-policy:create");
  if (denied) return denied;
  requestLog(request, user?.id, "price-policy.create");

  const meta = requestMeta(request);
  const parsed = pricePolicyCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const existing = await prisma.pricePolicy.findUnique({ where: { code: parsed.data.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "策略编码已存在");
  }

  const created = await prisma.pricePolicy.create({
    data: {
      code: parsed.data.code,
      name: parsed.data.name,
      policyType: parsed.data.policyType as PricePolicyType,
      priority: parsed.data.priority ?? 100,
      matchStrategy: (parsed.data.matchStrategy as PriceMatchStrategy) ?? "HIGHEST_PRIORITY",
      stopOnMatch: parsed.data.stopOnMatch ?? true,
      description: parsed.data.description ?? null,
      approvalStatus: "APPROVED",
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "price-policy.create",
    entityType: "pricePolicy",
    entityId: created.id,
    afterData: { code: created.code, name: created.name, policyType: created.policyType },
    ...meta,
  });

  return ok(created, undefined, 201);
}
