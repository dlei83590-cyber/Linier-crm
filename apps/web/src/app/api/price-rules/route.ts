import { NextRequest } from "next/server";
import type { PriceRuleType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const priceRuleCreateSchema = z.object({
  policyId: z.string().min(1),
  ruleType: z.enum(["CUSTOMER_LEVEL", "REGION", "QUANTITY_BREAK", "BRAND", "PROJECT_TYPE", "CURRENCY", "CHANNEL"]),
  ruleName: z.string().min(1).max(200),
  conditions: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  discountRate: z.coerce.number().min(0).max(100).optional(),
  priority: z.number().int().min(0).max(9999).optional(),
});

/** GET /api/price-rules（分页 + policyId/ruleType/isActive 过滤，Sprint 3C-4 Price Foundation） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-rule:view");
  if (denied) return denied;
  requestLog(request, user?.id, "price-rule.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const policyId = searchParams.get("policyId")?.trim();
  const ruleType = searchParams.get("ruleType")?.trim();
  const ruleName = searchParams.get("ruleName")?.trim();

  const where = {
    deletedAt: null,
    ...(policyId ? { policyId } : {}),
    ...(ruleType ? { ruleType: ruleType as PriceRuleType } : {}),
    ...(ruleName ? { ruleName: { contains: ruleName } } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.priceRule.count({ where }),
    prisma.priceRule.findMany({
      where,
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      skip,
      take,
      include: {
        policy: { select: { id: true, code: true, name: true, policyType: true } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/price-rules（创建规则：policyId 必填且策略需存在） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-rule:create");
  if (denied) return denied;
  requestLog(request, user?.id, "price-rule.create");

  const meta = requestMeta(request);
  const parsed = priceRuleCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const policy = await prisma.pricePolicy.findFirst({ where: { id: parsed.data.policyId, deletedAt: null } });
  if (!policy) return failConflict(ERROR_CODES.NOT_FOUND, "关联价格策略不存在");

  const created = await prisma.priceRule.create({
    data: {
      policyId: parsed.data.policyId,
      ruleType: parsed.data.ruleType as PriceRuleType,
      ruleName: parsed.data.ruleName,
      conditions: parsed.data.conditions ?? undefined,
      discountRate: parsed.data.discountRate ?? null,
      priority: parsed.data.priority ?? 100,
      approvalStatus: "APPROVED",
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "price-rule.create",
    entityType: "priceRule",
    entityId: created.id,
    afterData: { policyId: created.policyId, ruleName: created.ruleName, ruleType: created.ruleType },
    ...meta,
  });

  return ok(created, undefined, 201);
}
