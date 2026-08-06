import { NextRequest } from "next/server";
import type { PriceRuleType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const priceRuleUpdateSchema = z
  .object({
    ruleType: z.enum(["CUSTOMER_LEVEL", "REGION", "QUANTITY_BREAK", "BRAND", "PROJECT_TYPE", "CURRENCY", "CHANNEL"]).optional(),
    ruleName: z.string().min(1).max(200).optional(),
    conditions: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).nullable().optional(),
    discountRate: z.coerce.number().min(0).max(100).nullable().optional(),
    priority: z.number().int().min(0).max(9999).optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/price-rules/:id（详情含所属策略） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-rule:view");
  if (denied) return denied;
  requestLog(request, user?.id, "price-rule.get");

  const { id } = await params;
  const rule = await prisma.priceRule.findFirst({
    where: { id, deletedAt: null },
    include: { policy: { select: { id: true, code: true, name: true, policyType: true } } },
  });
  if (!rule) return failNotFound(ERROR_CODES.NOT_FOUND, "规则不存在");
  return ok(rule);
}

/** PATCH /api/price-rules/:id（乐观锁 version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-rule:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "price-rule.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = priceRuleUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;
  const existing = await prisma.priceRule.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "规则不存在");
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const updated = await prisma.priceRule.update({
    where: { id },
    data: {
      ...updates,
      ruleType: updates.ruleType as PriceRuleType | undefined,
      version: { increment: 1 },
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "price-rule.update",
    entityType: "priceRule",
    entityId: id,
    beforeData: { ruleName: existing.ruleName, discountRate: existing.discountRate },
    afterData: { ruleName: updated.ruleName, discountRate: updated.discountRate },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/price-rules/:id（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-rule:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "price-rule.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.priceRule.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "规则不存在");

  await prisma.priceRule.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "price-rule.delete",
    entityType: "priceRule",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
