import { NextRequest } from "next/server";
import type { PromotionType, PriceSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const promotionUpdateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    promotionType: z.enum(["PERCENT", "AMOUNT"]).optional(),
    discountValue: z.coerce.number().nonnegative().optional(),
    startAt: z.string().datetime().nullable().optional(),
    endAt: z.string().datetime().nullable().optional(),
    priority: z.number().int().min(0).max(9999).optional(),
    stackable: z.boolean().optional(),
    exclusive: z.boolean().optional(),
    priceSource: z.enum(["MANUAL", "IMPORT", "FORMULA", "PROMOTION", "SUPPLIER", "MARKET"]).optional(),
    status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "EXPIRED"]).optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/promotions/:id（促销详情） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "promotion:view");
  if (denied) return denied;
  requestLog(request, user?.id, "promotion.get");

  const { id } = await params;
  const promotion = await prisma.promotionRule.findFirst({ where: { id, deletedAt: null } });
  if (!promotion) return failNotFound(ERROR_CODES.NOT_FOUND, "促销不存在");
  return ok(promotion);
}

/** PATCH /api/promotions/:id（乐观锁 version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "promotion:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "promotion.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = promotionUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;
  const existing = await prisma.promotionRule.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "促销不存在");
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const updated = await prisma.promotionRule.update({
    where: { id },
    data: {
      ...updates,
      promotionType: updates.promotionType as PromotionType | undefined,
      priceSource: updates.priceSource as PriceSource | undefined,
      startAt: updates.startAt === undefined ? undefined : updates.startAt === null ? null : new Date(updates.startAt),
      endAt: updates.endAt === undefined ? undefined : updates.endAt === null ? null : new Date(updates.endAt),
      version: { increment: 1 },
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "promotion.update",
    entityType: "promotionRule",
    entityId: id,
    beforeData: { name: existing.name, discountValue: existing.discountValue, status: existing.status },
    afterData: { name: updated.name, discountValue: updated.discountValue, status: updated.status },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/promotions/:id（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "promotion:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "promotion.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.promotionRule.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "促销不存在");

  await prisma.promotionRule.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "promotion.delete",
    entityType: "promotionRule",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
