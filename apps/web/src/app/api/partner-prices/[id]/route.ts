import { NextRequest } from "next/server";
import type { PartnerRoleType, PriceSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { casUpdate } from "@/lib/api/cas";
import { z } from "zod";

export const dynamic = "force-dynamic";

const partnerPriceUpdateSchema = z
  .object({
    unitPrice: z.coerce.number().nonnegative().optional(),
    currency: z.string().max(10).optional(),
    partnerRoleType: z.enum(["CUSTOMER", "SUPPLIER", "BOTH", "LOGISTICS", "OUTSOURCING"]).optional(),
    partnerRoleName: z.string().max(100).nullable().optional(),
    taxProfileId: z.string().min(1).nullable().optional(),
    effectiveFrom: z.string().datetime().nullable().optional(),
    effectiveTo: z.string().datetime().nullable().optional(),
    priceSource: z.enum(["MANUAL", "IMPORT", "FORMULA", "PROMOTION", "SUPPLIER", "MARKET"]).optional(),
    priority: z.number().int().min(0).max(9999).optional(),
    approvalRequired: z.boolean().optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/partner-prices/:id（详情含伙伴/物料/税率档案） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-price:view");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-price.get");

  const { id } = await params;
  const price = await prisma.partnerPrice.findFirst({
    where: { id, deletedAt: null },
    include: {
      partner: { select: { id: true, code: true, name: true, type: true } },
      item: { select: { id: true, code: true, name: true, model: true } },
      taxProfile: { select: { id: true, code: true, name: true, rate: true } },
    },
  });
  if (!price) return failNotFound(ERROR_CODES.NOT_FOUND, "专属价不存在");
  return ok(price);
}

/** PATCH /api/partner-prices/:id（乐观锁 version；VIP 价可 approvalRequired 走审批） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-price:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-price.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = partnerPriceUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;
  const existing = await prisma.partnerPrice.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "专属价不存在");
  

  const cas = await casUpdate(prisma, 'partnerPrice', id, version, {
      ...updates,
      partnerRoleType: updates.partnerRoleType as PartnerRoleType | undefined,
      priceSource: updates.priceSource as PriceSource | undefined,
      effectiveFrom: updates.effectiveFrom === undefined ? undefined : updates.effectiveFrom === null ? null : new Date(updates.effectiveFrom),
      effectiveTo: updates.effectiveTo === undefined ? undefined : updates.effectiveTo === null ? null : new Date(updates.effectiveTo),
      updatedById: user!.id,
    
});
  if (cas.outcome === 'NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, "专属价不存在");
  if (cas.outcome === 'CONFLICT') return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  const updated = await prisma.partnerPrice.findFirst({ where: { id, deletedAt: null } });
  if (!updated) return failNotFound(ERROR_CODES.NOT_FOUND, "专属价不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "partner-price.update",
    entityType: "partnerPrice",
    entityId: id,
    beforeData: { unitPrice: existing.unitPrice, priority: existing.priority },
    afterData: { unitPrice: updated.unitPrice, priority: updated.priority },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/partner-prices/:id（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-price:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-price.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.partnerPrice.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "专属价不存在");

  await prisma.partnerPrice.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "partner-price.delete",
    entityType: "partnerPrice",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
