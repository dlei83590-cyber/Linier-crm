import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { casUpdate } from "@/lib/api/cas";
import { z } from "zod";

export const dynamic = "force-dynamic";

const specUpdateSchema = z
  .object({
    definitionId: z.string().min(1).nullable().optional(),
    specKey: z.string().min(1).max(100).optional(),
    specValue: z.string().min(1).max(500).optional(),
    unit: z.string().max(50).nullable().optional(),
    sort: z.number().int().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** PATCH /api/items/:id/specifications/:specId（乐观锁） */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; specId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-specification:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "item-specification.update");

  const { id, specId } = await params;
  const meta = requestMeta(request);
  const parsed = specUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.itemSpecification.findFirst({
    where: { id: specId, itemId: id, deletedAt: null },
  });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "规格不存在");
  

  const cas = await casUpdate(prisma, 'itemSpecification', specId, version, {...updates, updatedById: user!.id
});
  if (cas.outcome === 'NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, "规格不存在");
  if (cas.outcome === 'CONFLICT') return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  const updated = await prisma.itemSpecification.findFirst({ where: { id: specId, deletedAt: null } });
  if (!updated) return failNotFound(ERROR_CODES.NOT_FOUND, "规格不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "item-specification.update",
    entityType: "item-specification",
    entityId: specId,
    beforeData: { specKey: existing.specKey, specValue: existing.specValue },
    afterData: { specKey: updated.specKey, specValue: updated.specValue },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/items/:id/specifications/:specId（软删除） */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; specId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-specification:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "item-specification.delete");

  const { id, specId } = await params;
  const meta = requestMeta(request);

  const result = await prisma.itemSpecification.updateMany({
    where: { id: specId, itemId: id, deletedAt: null },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });
  if (result.count === 0) return failNotFound(ERROR_CODES.NOT_FOUND, "规格不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "item-specification.delete",
    entityType: "item-specification",
    entityId: specId,
    ...meta,
  });

  return ok({ id: specId, deleted: true });
}
