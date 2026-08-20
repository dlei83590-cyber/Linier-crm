import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { casUpdate } from "@/lib/api/cas";
import { z } from "zod";

export const dynamic = "force-dynamic";

const conversionUpdateSchema = z
  .object({
    fromUomId: z.string().min(1).optional(),
    toUomId: z.string().min(1).optional(),
    factor: z.coerce.number().positive().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** PATCH /api/items/:id/uom-conversions/:conversionId（乐观锁） */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; conversionId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-uom:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "item-uom.update");

  const { id, conversionId } = await params;
  const meta = requestMeta(request);
  const parsed = conversionUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.uomConversion.findFirst({
    where: { id: conversionId, itemId: id, deletedAt: null },
  });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "换算关系不存在");
  

  const cas = await casUpdate(prisma, 'uomConversion', id, version, { ...updates, version: { increment: 1 }, updatedById: user!.id 
});
  if (cas.outcome === 'NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, "换算关系不存在");
  if (cas.outcome === 'CONFLICT') return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  const updated = await prisma.uomConversion.findFirst({ where: { id, deletedAt: null } });
  if (!updated) return failNotFound(ERROR_CODES.NOT_FOUND, "换算关系不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "item-uom.update",
    entityType: "item-uom",
    entityId: conversionId,
    beforeData: { factor: existing.factor },
    afterData: { factor: updated.factor },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/items/:id/uom-conversions/:conversionId（软删除） */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; conversionId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-uom:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "item-uom.delete");

  const { id, conversionId } = await params;
  const meta = requestMeta(request);

  const result = await prisma.uomConversion.updateMany({
    where: { id: conversionId, itemId: id, deletedAt: null },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });
  if (result.count === 0) return failNotFound(ERROR_CODES.NOT_FOUND, "换算关系不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "item-uom.delete",
    entityType: "item-uom",
    entityId: conversionId,
    ...meta,
  });

  return ok({ id: conversionId, deleted: true });
}
