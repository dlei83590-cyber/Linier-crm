import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { casUpdate } from "@/lib/api/cas";
import { collectReferences, failReferenceConflict, REFERENCE_SAMPLE_LIMIT } from "@/lib/api/reference-guard";
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
  // 引用出处（问题二）：按业务单据族分别给出条数 + 真实单据编号（不再只报「已被引用」）
  const references = await collectReferences([
    {
      entity: "入库单",
      count: () => Promise.resolve(c.warehouseReceipts),
      samples: async () =>
        (
          await prisma.warehouseReceipt.findMany({
            where: { locationId: id },
            take: REFERENCE_SAMPLE_LIMIT,
            orderBy: { createdAt: "desc" },
            select: { code: true },
          })
        ).map((r) => r.code),
      releaseHint: "先回退/删除对应入库单",
    },
    {
      entity: "库存流水",
      count: () => Promise.resolve(c.inventoryMovements),
      samples: async () =>
        (
          await prisma.inventoryMovement.findMany({
            where: { locationId: id },
            take: REFERENCE_SAMPLE_LIMIT,
            orderBy: { committedAt: "desc" },
            select: { movementNo: true },
          })
        ).map((m) => m.movementNo),
      releaseHint: "库存流水为不可变事实（保持库存溯源）",
    },
    {
      entity: "库存投影（物料）",
      count: () => Promise.resolve(c.stockProjections),
      samples: async () =>
        (
          await prisma.stockProjection.findMany({
            where: { locationId: id },
            take: REFERENCE_SAMPLE_LIMIT,
            select: { item: { select: { code: true } } },
          })
        ).map((p) => p.item.code),
      releaseHint: "该库位仍有库存余额投影（需先清空该库位库存）",
    },
    {
      entity: "库存调拨单",
      count: () => Promise.resolve(c.transferSourceLocations + c.transferDestinationLocations),
      samples: async () =>
        (
          await prisma.inventoryTransfer.findMany({
            where: {
              OR: [{ sourceLocationId: id }, { destinationLocationId: id }],
              deletedAt: null,
            },
            take: REFERENCE_SAMPLE_LIMIT,
            orderBy: { createdAt: "desc" },
            select: { transferNo: true },
          })
        ).map((t) => t.transferNo),
      releaseHint: "先删除对应调拨单",
    },
    {
      entity: "库存盘点单",
      count: () => Promise.resolve(c.stockCountLines),
      samples: async () =>
        (
          await prisma.stockCountLine.findMany({
            where: { locationId: id, deletedAt: null },
            take: REFERENCE_SAMPLE_LIMIT,
            select: { countHeader: { select: { countNo: true } } },
          })
        ).map((l) => l.countHeader.countNo),
      releaseHint: "先删除对应盘点单",
    },
    {
      entity: "库存调整单",
      count: () => Promise.resolve(c.adjustmentLines),
      samples: async () =>
        (
          await prisma.inventoryAdjustmentLine.findMany({
            where: { locationId: id, deletedAt: null },
            take: REFERENCE_SAMPLE_LIMIT,
            select: { adjustmentHeader: { select: { adjustmentNo: true } } },
          })
        ).map((l) => l.adjustmentHeader.adjustmentNo),
      releaseHint: "先删除对应调整单",
    },
    {
      entity: "库存转换单",
      count: () => Promise.resolve(c.conversionLines),
      samples: async () =>
        (
          await prisma.inventoryConversionLine.findMany({
            where: { locationId: id, deletedAt: null },
            take: REFERENCE_SAMPLE_LIMIT,
            select: { conversionHeader: { select: { conversionNo: true } } },
          })
        ).map((l) => l.conversionHeader.conversionNo),
      releaseHint: "先删除对应转换单",
    },
  ]);
  if (references.length > 0) {
    return failReferenceConflict(ERROR_CODES.CONFLICT, `库位「${existing.code}」`, references);
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
