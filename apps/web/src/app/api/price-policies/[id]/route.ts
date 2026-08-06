import { NextRequest } from "next/server";
import type { PricePolicyType, PriceMatchStrategy } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const pricePolicyUpdateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    policyType: z.enum(["STANDARD", "VIP", "PROJECT", "DEALER", "REGIONAL", "PROMOTION"]).optional(),
    priority: z.number().int().min(0).max(9999).optional(),
    matchStrategy: z.enum(["FIRST_MATCH", "BEST_PRICE", "LOWEST_PRICE", "HIGHEST_PRIORITY", "COMBINE"]).optional(),
    stopOnMatch: z.boolean().optional(),
    description: z.string().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/price-policies/:id（详情含规则列表） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-policy:view");
  if (denied) return denied;
  requestLog(request, user?.id, "price-policy.get");

  const { id } = await params;
  const policy = await prisma.pricePolicy.findFirst({
    where: { id, deletedAt: null },
    include: {
      rules: { where: { deletedAt: null }, orderBy: [{ priority: "asc" }, { createdAt: "desc" }] },
    },
  });
  if (!policy) return failNotFound(ERROR_CODES.NOT_FOUND, "策略不存在");
  return ok(policy);
}

/** PATCH /api/price-policies/:id（乐观锁 version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-policy:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "price-policy.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = pricePolicyUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;
  const existing = await prisma.pricePolicy.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "策略不存在");
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const updated = await prisma.pricePolicy.update({
    where: { id },
    data: {
      ...updates,
      policyType: updates.policyType as PricePolicyType | undefined,
      matchStrategy: updates.matchStrategy as PriceMatchStrategy | undefined,
      version: { increment: 1 },
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "price-policy.update",
    entityType: "pricePolicy",
    entityId: id,
    beforeData: { name: existing.name, priority: existing.priority },
    afterData: { name: updated.name, priority: updated.priority },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/price-policies/:id（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-policy:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "price-policy.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.pricePolicy.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "策略不存在");

  await prisma.pricePolicy.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "price-policy.delete",
    entityType: "pricePolicy",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
