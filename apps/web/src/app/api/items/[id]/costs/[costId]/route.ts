import { NextRequest } from "next/server";
import type { ItemCostType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { casUpdate } from "@/lib/api/cas";
import { z } from "zod";

export const dynamic = "force-dynamic";

const costUpdateSchema = z
  .object({
    costType: z.enum(["STANDARD", "LAST_PURCHASE", "AVERAGE", "CURRENT"]).optional(),
    amount: z.coerce.number().nonnegative().optional(),
    currency: z.string().max(10).optional(),
    effectiveFrom: z.string().datetime().nullable().optional(),
    effectiveTo: z.string().datetime().nullable().optional(),
    source: z.string().max(100).nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** PATCH /api/items/:id/costs/:costId（乐观锁） */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; costId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-cost:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "item-cost.update");

  const { id, costId } = await params;
  const meta = requestMeta(request);
  const parsed = costUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.itemCost.findFirst({
    where: { id: costId, itemId: id, deletedAt: null },
  });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "成本记录不存在");
  

  const cas = await casUpdate(prisma, 'itemCost', costId, version, {...updates,
      costType: updates.costType as ItemCostType | undefined,
      effectiveFrom: updates.effectiveFrom === undefined ? undefined : updates.effectiveFrom === null ? null : new Date(updates.effectiveFrom),
      effectiveTo: updates.effectiveTo === undefined ? undefined : updates.effectiveTo === null ? null : new Date(updates.effectiveTo),
      updatedById: user!.id,
});
  if (cas.outcome === 'NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, "成本记录不存在");
  if (cas.outcome === 'CONFLICT') return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  const updated = await prisma.itemCost.findFirst({ where: { id: costId, deletedAt: null } });
  if (!updated) return failNotFound(ERROR_CODES.NOT_FOUND, "成本记录不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "item-cost.update",
    entityType: "item-cost",
    entityId: costId,
    beforeData: { costType: existing.costType, amount: existing.amount },
    afterData: { costType: updated.costType, amount: updated.amount },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/items/:id/costs/:costId（软删除） */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; costId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-cost:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "item-cost.delete");

  const { id, costId } = await params;
  const meta = requestMeta(request);

  const result = await prisma.itemCost.updateMany({
    where: { id: costId, itemId: id, deletedAt: null },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });
  if (result.count === 0) return failNotFound(ERROR_CODES.NOT_FOUND, "成本记录不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "item-cost.delete",
    entityType: "item-cost",
    entityId: costId,
    ...meta,
  });

  return ok({ id: costId, deleted: true });
}
