import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { casUpdate } from "@/lib/api/cas";
import { z } from "zod";

export const dynamic = "force-dynamic";

const warehouseLocationUpdateSchema = z
  .object({
    code: z.string().min(1).max(64).optional(),
    name: z.string().min(1).max(200).optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/warehouse-locations/:id（详情） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "warehouse-location:view");
  if (denied) return denied;
  requestLog(request, user?.id, "warehouse-location.get");

  const { id } = await params;
  const location = await prisma.warehouseLocation.findFirst({
    where: { id, deletedAt: null },
    include: { warehouse: { select: { id: true, code: true, name: true } } },
  });
  if (!location) return failNotFound(ERROR_CODES.NOT_FOUND, "库位不存在");
  return ok(location);
}

/** PATCH /api/warehouse-locations/:id（乐观锁 version；同仓库 code 唯一） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "warehouse-location:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "warehouse-location.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = warehouseLocationUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;
  const existing = await prisma.warehouseLocation.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "库位不存在");

  if (updates.code) {
    const dup = await prisma.warehouseLocation.findFirst({
      where: { warehouseId: existing.warehouseId, code: updates.code, deletedAt: null },
    });
    if (dup && dup.id !== id) return failConflict(ERROR_CODES.CONFLICT, "该仓库下库位编码已存在");
  }

  const cas = await casUpdate(prisma, "warehouseLocation", id, version, {
    ...updates,
    updatedById: user!.id,
  });
  if (cas.outcome === "NOT_FOUND") return failNotFound(ERROR_CODES.NOT_FOUND, "库位不存在");
  if (cas.outcome === "CONFLICT") return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  const updated = await prisma.warehouseLocation.findFirst({
    where: { id, deletedAt: null },
    include: { warehouse: { select: { id: true, code: true, name: true } } },
  });
  if (!updated) return failNotFound(ERROR_CODES.NOT_FOUND, "库位不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "warehouse-location.update",
    entityType: "warehouseLocation",
    entityId: id,
    beforeData: { code: existing.code, name: existing.name },
    afterData: { code: updated.code, name: updated.name },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/warehouse-locations/:id（软删除；被库存流水/单据/盘点/调拨/调整/转换引用 → 不可删除（可编辑）） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "warehouse-location:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "warehouse-location.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.warehouseLocation.findFirst({
    where: { id, deletedAt: null },
    include: {
      _count: {
        select: {
          warehouseReceipts: true,
          inventoryMovements: true,
          stockProjections: true,
          transferSourceLocations: true,
          transferDestinationLocations: true,
          stockCountLines: true,
          adjustmentLines: true,
          conversionLines: true,
        },
      },
    },
  });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "库位不存在");

  const c = existing._count;
  const referenced =
    c.warehouseReceipts +
    c.inventoryMovements +
    c.stockProjections +
    c.transferSourceLocations +
    c.transferDestinationLocations +
    c.stockCountLines +
    c.adjustmentLines +
    c.conversionLines;
  if (referenced > 0) {
    return failConflict(ERROR_CODES.CONFLICT, "库位已被库存流水/单据/盘点/调拨/调整/转换引用，不能删除（可编辑）");
  }

  await prisma.warehouseLocation.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "warehouse-location.delete",
    entityType: "warehouseLocation",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
