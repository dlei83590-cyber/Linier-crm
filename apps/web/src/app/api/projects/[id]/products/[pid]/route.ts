import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog, assertProjectWritable } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const productUpdateSchema = z
  .object({
    quantity: z.coerce.number().nonnegative().nullable().optional(),
    priceSnapshotId: z.string().min(1).nullable().optional(),
    note: z.string().max(500).nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/projects/:id/products/:pid（项目产品详情） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; pid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-product:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-product.get");

  const { id, pid } = await params;
  const item = await prisma.projectProduct.findFirst({
    where: { id: pid, projectId: id, deletedAt: null },
    include: {
      item: { select: { id: true, code: true, name: true, model: true } },
      priceSnapshot: { select: { id: true, finalUnitPrice: true, finalAmount: true, currency: true, pricingTime: true } },
    },
  });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "项目产品不存在");
  return ok(item);
}

/** PATCH /api/projects/:id/products/:pid（乐观锁 version；可更新价格快照引用） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; pid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-product:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "project-product.update");

  const { id, pid } = await params;
  const meta = requestMeta(request);
  const parsed = productUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const txResult = await prisma.$transaction(async (tx) => {
    const gate = await assertProjectWritable(tx, id);
    if (!gate.ok) return { error: gate.response };


    const { version, ...updates } = parsed.data;
    const existing = await tx.projectProduct.findFirst({ where: { id: pid, projectId: id, deletedAt: null } });
    if (!existing) return { error: failNotFound(ERROR_CODES.NOT_FOUND, "项目产品不存在") };
    if (existing.version !== version) {
      return { error: failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试") };
    }

  if (updates.priceSnapshotId) {
      const snapshot = await tx.quotationPriceSnapshot.findFirst({ where: { id: updates.priceSnapshotId } });
    if (!snapshot) return { error: failConflict(ERROR_CODES.NOT_FOUND, "价格快照不存在") };
  }

  const updated = await tx.projectProduct.update({
    where: { id: pid },
    data: { ...updates, version: { increment: 1 }, updatedById: user!.id },
  });
    return { updated, existing };
  });
  if ("error" in txResult) return txResult.error;
  const { updated, existing } = txResult;

  await writeAuditLog({
    actorId: user?.id,
    action: "project-product.update",
    entityType: "projectProduct",
    entityId: pid,
    beforeData: { itemId: existing.itemId, priceSnapshotId: existing.priceSnapshotId },
    afterData: { itemId: updated.itemId, priceSnapshotId: updated.priceSnapshotId },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/projects/:id/products/:pid（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; pid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-product:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "project-product.delete");

  const { id, pid } = await params;
  const meta = requestMeta(request);

  const txResult = await prisma.$transaction(async (tx) => {
    const gate = await assertProjectWritable(tx, id);
    if (!gate.ok) return { error: gate.response };

    const existing = await tx.projectProduct.findFirst({ where: { id: pid, projectId: id, deletedAt: null } });
    if (!existing) return { error: failNotFound(ERROR_CODES.NOT_FOUND, "项目产品不存在") };

  await tx.projectProduct.update({
    where: { id: pid },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });
    return { ok: true };
  });
  if ("error" in txResult) return txResult.error;

  await writeAuditLog({
    actorId: user?.id,
    action: "project-product.delete",
    entityType: "projectProduct",
    entityId: pid,
    ...meta,
  });

  return ok({ id: pid, deleted: true });
}
