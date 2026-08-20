import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { casUpdate } from "@/lib/api/cas";
import { z } from "zod";

export const dynamic = "force-dynamic";

const taxRateUpdateSchema = z
  .object({
    rate: z.coerce.number().min(0).max(100).optional(),
    effectiveFrom: z.string().datetime().nullable().optional(),
    effectiveTo: z.string().datetime().nullable().optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/tax-rates/:id（税率详情） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "tax-rate:view");
  if (denied) return denied;
  requestLog(request, user?.id, "tax-rate.get");

  const { id } = await params;
  const rate = await prisma.taxRate.findFirst({
    where: { id, deletedAt: null },
    include: { taxProfile: { select: { id: true, code: true, name: true, country: true, taxIncluded: true } } },
  });
  if (!rate) return failNotFound(ERROR_CODES.NOT_FOUND, "税率不存在");
  return ok(rate);
}

/** PATCH /api/tax-rates/:id（乐观锁 version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "tax-rate:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "tax-rate.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = taxRateUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;
  const existing = await prisma.taxRate.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "税率不存在");
  

  const cas = await casUpdate(prisma, 'taxRate', id, version, {
      ...updates,
      effectiveFrom: updates.effectiveFrom === undefined ? undefined : updates.effectiveFrom === null ? null : new Date(updates.effectiveFrom),
      effectiveTo: updates.effectiveTo === undefined ? undefined : updates.effectiveTo === null ? null : new Date(updates.effectiveTo),

      updatedById: user!.id,
    
});
  if (cas.outcome === 'NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, "税率不存在");
  if (cas.outcome === 'CONFLICT') return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  const updated = await prisma.taxRate.findFirst({ where: { id, deletedAt: null } });
  if (!updated) return failNotFound(ERROR_CODES.NOT_FOUND, "税率不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "tax-rate.update",
    entityType: "taxRate",
    entityId: id,
    beforeData: { rate: existing.rate, effectiveFrom: existing.effectiveFrom },
    afterData: { rate: updated.rate, effectiveFrom: updated.effectiveFrom },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/tax-rates/:id（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "tax-rate:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "tax-rate.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.taxRate.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "税率不存在");

  await prisma.taxRate.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "tax-rate.delete",
    entityType: "taxRate",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
