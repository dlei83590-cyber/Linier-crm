import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const priceListItemUpdateSchema = z
  .object({
    unitPriceExclTax: z.coerce.number().positive().optional(),
    taxRate: z.coerce.number().min(0).max(100).optional(),
    minOrderQty: z.coerce.number().positive().nullable().optional(),
    effectiveFrom: z.string().datetime().nullable().optional(),
    effectiveTo: z.string().datetime().nullable().optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/price-lists/:id/items/:itemId（单价行详情，含物料摘要） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-list:view");
  if (denied) return denied;
  requestLog(request, user?.id, "price-list.item.get");

  const { id, itemId } = await params;
  const item = await prisma.priceListItem.findFirst({
    where: { id: itemId, priceListId: id, deletedAt: null },
    include: { item: { select: { id: true, code: true, name: true, model: true } } },
  });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "价格条目不存在");
  return ok(item);
}

/** PATCH /api/price-lists/:id/items/:itemId（更新单价行：金额服务端重算 + CAS version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-list:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "price-list.item.update");

  const { id, itemId } = await params;
  const meta = requestMeta(request);
  const parsed = priceListItemUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const existing = await prisma.priceListItem.findFirst({
    where: { id: itemId, priceListId: id, deletedAt: null },
  });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "价格条目不存在");

  const { version, ...updates } = parsed.data;
  // 金额服务端 canonical 重算：以现有值 + 更新值合并后重算（不信任客户端 taxAmount/incl）
  const exclD = updates.unitPriceExclTax !== undefined ? new Prisma.Decimal(updates.unitPriceExclTax) : existing.unitPriceExclTax;
  const taxRateD = updates.taxRate !== undefined ? new Prisma.Decimal(updates.taxRate) : existing.taxRate;
  const taxAmount = exclD.mul(taxRateD).div(100);
  const incl = exclD.plus(taxAmount);

  const data: Record<string, unknown> = {
    ...(updates.unitPriceExclTax !== undefined ? { unitPriceExclTax: exclD } : {}),
    ...(updates.taxRate !== undefined ? { taxRate: taxRateD } : {}),
    ...(updates.minOrderQty !== undefined ? { minOrderQty: updates.minOrderQty === null ? null : new Prisma.Decimal(updates.minOrderQty) } : {}),
    ...(updates.effectiveFrom !== undefined ? { effectiveFrom: updates.effectiveFrom === null ? null : new Date(updates.effectiveFrom) } : {}),
    ...(updates.effectiveTo !== undefined ? { effectiveTo: updates.effectiveTo === null ? null : new Date(updates.effectiveTo) } : {}),
    ...(updates.isActive !== undefined ? { isActive: updates.isActive } : {}),
    ...(updates.unitPriceExclTax !== undefined || updates.taxRate !== undefined ? { taxAmount, unitPriceInclTax: incl } : {}),
    updatedById: user!.id,
  };

  const cas = await prisma.priceListItem.updateMany({
    where: { id: itemId, priceListId: id, version, deletedAt: null },
    data: { ...data, version: { increment: 1 } },
  });
  if (cas.count !== 1) {
    const still = await prisma.priceListItem.findFirst({ where: { id: itemId, priceListId: id, deletedAt: null } });
    return still ? failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试") : failNotFound(ERROR_CODES.NOT_FOUND, "价格条目不存在");
  }

  const updated = await prisma.priceListItem.findFirst({
    where: { id: itemId, priceListId: id, deletedAt: null },
    include: { item: { select: { id: true, code: true, name: true, model: true } } },
  });
  if (!updated) return failNotFound(ERROR_CODES.NOT_FOUND, "价格条目不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "price-list.item.update",
    entityType: "priceListItem",
    entityId: itemId,
    beforeData: { unitPriceExclTax: existing.unitPriceExclTax.toString() },
    afterData: { unitPriceExclTax: updated.unitPriceExclTax.toString() },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/price-lists/:id/items/:itemId（软删除单价行） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-list:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "price-list.item.delete");

  const { id, itemId } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.priceListItem.findFirst({
    where: { id: itemId, priceListId: id, deletedAt: null },
  });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "价格条目不存在");

  await prisma.priceListItem.update({
    where: { id: itemId },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "price-list.item.delete",
    entityType: "priceListItem",
    entityId: itemId,
    ...meta,
  });

  return ok({ id: itemId, deleted: true });
}
