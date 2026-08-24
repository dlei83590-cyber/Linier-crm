import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, fail, failValidation, failNotFound } from "@/lib/api/response";
import { handleServerError } from "@/lib/api/server-error";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";
import { validateRule } from "@/lib/customer-pool/validators";

export const dynamic = "force-dynamic";

const ruleCreateSchema = z.object({
  ruleType: z.enum(["FIELD_MATCH", "INACTIVITY"]).optional(),
  matchMode: z.enum(["ALL", "ANY"]).optional(),
  condition: z.array(z.record(z.string(), z.unknown())),
  priority: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

/** GET /api/customer-pools/:id/rules（公海规则列表；pool 必须存在） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-pool:view");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-pool-rule.list");

  const { id } = await params;
  const pool = await prisma.customerPool.findFirst({ where: { id, deletedAt: null } });
  if (!pool) return failNotFound(ERROR_CODES.POOL_NOT_FOUND, "公海池不存在");

  const rules = await prisma.customerPoolRule.findMany({
    where: { poolId: id, deletedAt: null },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
  return ok(rules);
}

/** POST /api/customer-pools/:id/rules（创建规则；INACTIVITY 在 Phase 3 前拒绝 → 400 POOL_RULE_SOURCE_UNAVAILABLE） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-pool:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-pool-rule.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = ruleCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const pool = await prisma.customerPool.findFirst({ where: { id, deletedAt: null } });
  if (!pool) return failNotFound(ERROR_CODES.POOL_NOT_FOUND, "公海池不存在");

  const ruleCheck = validateRule(
    parsed.data.ruleType ?? "FIELD_MATCH",
    parsed.data.matchMode ?? "ANY",
    parsed.data.condition,
  );
  if (!ruleCheck.ok) {
    return fail(ruleCheck.errorCode ?? ERROR_CODES.POOL_RULE_INVALID, ruleCheck.message ?? "规则非法", 400);
  }

  let created;
  try {
    created = await prisma.customerPoolRule.create({
      data: {
        poolId: id,
        ruleType: parsed.data.ruleType ?? "FIELD_MATCH",
        matchMode: parsed.data.matchMode ?? "ANY",
        condition: parsed.data.condition as Prisma.InputJsonValue,
        priority: parsed.data.priority ?? 0,
        isActive: parsed.data.isActive ?? true,
        createdById: user?.id ?? null,
        updatedById: user?.id ?? null,
      },
    });
  } catch (e) {
    return handleServerError(request, user?.id, "customer-pool-rule.create", e);
  }

  await writeAuditLog({
    actorId: user?.id,
    action: "customer-pool-rule.create",
    entityType: "customerPoolRule",
    entityId: created.id,
    afterData: { poolId: id, ruleType: created.ruleType, priority: created.priority },
    ...meta,
  });

  return ok(created, undefined, 201);
}
