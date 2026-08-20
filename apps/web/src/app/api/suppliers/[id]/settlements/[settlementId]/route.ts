import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { casUpdate } from "@/lib/api/cas";
import { z } from "zod";

export const dynamic = "force-dynamic";

const settlementUpdateSchema = z
  .object({
    paymentTerms: z.string().max(200).nullable().optional(),
    creditDays: z.number().int().nonnegative().nullable().optional(),
    paymentMethod: z.string().max(50).nullable().optional(),
    currency: z.string().max(10).optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** PATCH /api/suppliers/:id/settlements/:settlementId（乐观锁） */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; settlementId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "supplier-settlement:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "supplier-settlement.update");

  const { id, settlementId } = await params;
  const meta = requestMeta(request);
  const parsed = settlementUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.supplierSettlement.findFirst({
    where: { id: settlementId, supplierId: id, deletedAt: null },
  });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "结算条款不存在");
  

  const cas = await casUpdate(prisma, 'supplierSettlement', settlementId, version, {...updates, updatedById: user!.id
});
  if (cas.outcome === 'NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, "结算条款不存在");
  if (cas.outcome === 'CONFLICT') return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  const updated = await prisma.supplierSettlement.findFirst({ where: { id: settlementId, deletedAt: null } });
  if (!updated) return failNotFound(ERROR_CODES.NOT_FOUND, "结算条款不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "supplier-settlement.update",
    entityType: "supplier-settlement",
    entityId: settlementId,
    beforeData: { paymentTerms: existing.paymentTerms, creditDays: existing.creditDays },
    afterData: { paymentTerms: updated.paymentTerms, creditDays: updated.creditDays },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/suppliers/:id/settlements/:settlementId（软删除） */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; settlementId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "supplier-settlement:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "supplier-settlement.delete");

  const { id, settlementId } = await params;
  const meta = requestMeta(request);

  const result = await prisma.supplierSettlement.updateMany({
    where: { id: settlementId, supplierId: id, deletedAt: null },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });
  if (result.count === 0) return failNotFound(ERROR_CODES.NOT_FOUND, "结算条款不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "supplier-settlement.delete",
    entityType: "supplier-settlement",
    entityId: settlementId,
    ...meta,
  });

  return ok({ id: settlementId, deleted: true });
}
