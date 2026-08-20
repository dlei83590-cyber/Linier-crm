import { NextRequest } from "next/server";
import type { ExchangeRateType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { casUpdate } from "@/lib/api/cas";
import { z } from "zod";

export const dynamic = "force-dynamic";

const exchangeRateUpdateSchema = z
  .object({
    rate: z.coerce.number().positive().optional(),
    provider: z.string().max(50).nullable().optional(),
    source: z.string().max(50).nullable().optional(),
    rateType: z.enum(["CENTRAL_BANK", "BANK", "MANUAL"]).optional(),
    manualOverride: z.boolean().optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/exchange-rates/:id（汇率详情） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "exchange-rate:view");
  if (denied) return denied;
  requestLog(request, user?.id, "exchange-rate.get");

  const { id } = await params;
  const rate = await prisma.exchangeRate.findFirst({ where: { id, deletedAt: null } });
  if (!rate) return failNotFound(ERROR_CODES.NOT_FOUND, "汇率不存在");
  return ok(rate);
}

/** PATCH /api/exchange-rates/:id（乐观锁 version；人工覆盖标注 manualOverride） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "exchange-rate:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "exchange-rate.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = exchangeRateUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;
  const existing = await prisma.exchangeRate.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "汇率不存在");
  

  const cas = await casUpdate(prisma, 'exchangeRate', id, version, {
      ...updates,
      rateType: updates.rateType as ExchangeRateType | undefined,
      updatedById: user!.id,
    
});
  if (cas.outcome === 'NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, "汇率不存在");
  if (cas.outcome === 'CONFLICT') return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  const updated = await prisma.exchangeRate.findFirst({ where: { id, deletedAt: null } });
  if (!updated) return failNotFound(ERROR_CODES.NOT_FOUND, "汇率不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "exchange-rate.update",
    entityType: "exchangeRate",
    entityId: id,
    beforeData: { baseCurrency: existing.baseCurrency, quoteCurrency: existing.quoteCurrency, rate: existing.rate },
    afterData: { baseCurrency: updated.baseCurrency, quoteCurrency: updated.quoteCurrency, rate: updated.rate },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/exchange-rates/:id（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "exchange-rate:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "exchange-rate.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.exchangeRate.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "汇率不存在");

  await prisma.exchangeRate.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "exchange-rate.delete",
    entityType: "exchangeRate",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
