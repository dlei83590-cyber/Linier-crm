import { NextRequest } from "next/server";
import type { PriceListStatus, PriceType, PriceSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { casUpdate } from "@/lib/api/cas";
import { z } from "zod";

export const dynamic = "force-dynamic";

const priceListUpdateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    priceType: z.enum(["PURCHASE", "SALES", "VIP", "AGENT", "ENGINEERING", "STRATEGIC", "REGIONAL", "CUSTOMER", "HISTORICAL"]).optional(),
    currency: z.string().max(10).optional(),
    pricePolicyId: z.string().min(1).nullable().optional(),
    policyType: z.enum(["STANDARD", "VIP", "PROJECT", "DEALER", "REGIONAL", "PROMOTION"]).nullable().optional(),
    baseCurrency: z.string().max(10).optional(),
    quoteCurrency: z.string().max(10).optional(),
    status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
    effectiveFrom: z.string().datetime().nullable().optional(),
    effectiveTo: z.string().datetime().nullable().optional(),
    priceSource: z.enum(["MANUAL", "IMPORT", "FORMULA", "PROMOTION", "SUPPLIER", "MARKET"]).optional(),
    freightIncluded: z.boolean().optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/price-lists/:id（详情含策略/版本/明细，Sprint 3C-4） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-list:view");
  if (denied) return denied;
  requestLog(request, user?.id, "price-list.get");

  const { id } = await params;
  const priceList = await prisma.priceList.findFirst({
    where: { id, deletedAt: null },
    include: {
      policy: { select: { id: true, code: true, name: true, policyType: true } },
      versions: { where: { deletedAt: null }, orderBy: [{ versionNo: "desc" }] },
      items: {
        where: { deletedAt: null, isActive: true },
        orderBy: [{ minOrderQty: "asc" }],
        include: { item: { select: { id: true, code: true, name: true, model: true } } },
      },
    },
  });
  if (!priceList) return failNotFound(ERROR_CODES.NOT_FOUND, "价目表不存在");
  return ok(priceList);
}

/** PATCH /api/price-lists/:id（乐观锁 version；发布状态由版本流程控制） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-list:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "price-list.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = priceListUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;
  const existing = await prisma.priceList.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "价目表不存在");
  

  const cas = await casUpdate(prisma, 'priceList', id, version, {
      ...updates,
      priceType: updates.priceType as PriceType | undefined,
      status: updates.status as PriceListStatus | undefined,
      priceSource: updates.priceSource as PriceSource | undefined,
      policyType: updates.policyType as never,
      effectiveFrom: updates.effectiveFrom === undefined ? undefined : updates.effectiveFrom === null ? null : new Date(updates.effectiveFrom),
      effectiveTo: updates.effectiveTo === undefined ? undefined : updates.effectiveTo === null ? null : new Date(updates.effectiveTo),

      updatedById: user!.id,
    
});
  if (cas.outcome === 'NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, "价目表不存在");
  if (cas.outcome === 'CONFLICT') return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  const updated = await prisma.priceList.findFirst({ where: { id, deletedAt: null } });
  if (!updated) return failNotFound(ERROR_CODES.NOT_FOUND, "价目表不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "price-list.update",
    entityType: "priceList",
    entityId: id,
    beforeData: { name: existing.name, status: existing.status },
    afterData: { name: updated.name, status: updated.status },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/price-lists/:id（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-list:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "price-list.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.priceList.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "价目表不存在");

  await prisma.priceList.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "price-list.delete",
    entityType: "priceList",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
