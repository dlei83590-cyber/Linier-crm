import { NextRequest } from "next/server";
import type { TaxRateType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { casUpdate } from "@/lib/api/cas";
import { z } from "zod";

export const dynamic = "force-dynamic";

const taxProfileUpdateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    country: z.string().max(10).nullable().optional(),
    region: z.string().max(50).nullable().optional(),
    taxIncluded: z.boolean().optional(),
    rateType: z.enum(["ZERO", "SIX", "THIRTEEN", "EXEMPT", "CUSTOM"]).optional(),
    rate: z.coerce.number().min(0).max(100).nullable().optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/tax-profiles/:id（详情含税率与规则） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "tax-profile:view");
  if (denied) return denied;
  requestLog(request, user?.id, "tax-profile.get");

  const { id } = await params;
  const profile = await prisma.taxProfile.findFirst({
    where: { id, deletedAt: null },
    include: {
      taxRates: { where: { deletedAt: null }, orderBy: [{ effectiveFrom: "desc" }] },
      taxProfileRules: { where: { isActive: true }, orderBy: [{ priority: "asc" }] },
    },
  });
  if (!profile) return failNotFound(ERROR_CODES.NOT_FOUND, "税率档案不存在");
  return ok(profile);
}

/** PATCH /api/tax-profiles/:id（乐观锁 version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "tax-profile:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "tax-profile.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = taxProfileUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;
  const existing = await prisma.taxProfile.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "税率档案不存在");
  

  const cas = await casUpdate(prisma, 'taxProfile', id, version, {
      ...updates,
      rateType: updates.rateType as TaxRateType | undefined,

      updatedById: user!.id,
    
});
  if (cas.outcome === 'NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, "税率档案不存在");
  if (cas.outcome === 'CONFLICT') return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  const updated = await prisma.taxProfile.findFirst({ where: { id, deletedAt: null } });
  if (!updated) return failNotFound(ERROR_CODES.NOT_FOUND, "税率档案不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "tax-profile.update",
    entityType: "taxProfile",
    entityId: id,
    beforeData: { name: existing.name, rate: existing.rate, taxIncluded: existing.taxIncluded },
    afterData: { name: updated.name, rate: updated.rate, taxIncluded: updated.taxIncluded },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/tax-profiles/:id（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "tax-profile:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "tax-profile.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.taxProfile.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "税率档案不存在");

  await prisma.taxProfile.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "tax-profile.delete",
    entityType: "taxProfile",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
