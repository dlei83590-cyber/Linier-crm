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

const warehouseUpdateSchema = z
  .object({
    code: z.string().min(1).max(64).optional(),
    name: z.string().min(1).max(200).optional(),
    type: z.string().max(64).nullable().optional(),
    address: z.string().max(500).nullable().optional(),
    remark: z.string().max(1000).nullable().optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/warehouses/:id（详情，含库位与引用计数） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "warehouse:view");
  if (denied) return denied;
  requestLog(request, user?.id, "warehouse.get");

  const { id } = await params;
  const warehouse = await prisma.warehouse.findFirst({
    where: { id, deletedAt: null },
    include: {
      locations: { where: { deletedAt: null }, orderBy: { code: "asc" } },
      _count: {
        select: {
          locations: { where: { deletedAt: null } },
        },
      },
    },
  });
  if (!warehouse) return failNotFound(ERROR_CODES.NOT_FOUND, "仓库不存在");
  return ok(warehouse);
}

/** PATCH /api/warehouses/:id（编辑；乐观锁 version——被引用后仍可编辑） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "warehouse:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "warehouse.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = warehouseUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;
  const existing = await prisma.warehouse.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "仓库不存在");

  if (updates.code) {
    const codeExisting = await prisma.warehouse.findUnique({ where: { code: updates.code } });
    if (codeExisting && codeExisting.id !== id && !codeExisting.deletedAt) {
      return failConflict(ERROR_CODES.CONFLICT, "仓库编码已存在");
    }
  }

  // A4-CAS：原子乐观锁（read-check-update TOCTOU → updateMany where version）
  const cas = await casUpdate(prisma, "warehouse", id, version, {
    ...(updates.code !== undefined ? { code: updates.code.trim() } : {}),
    ...(updates.name !== undefined ? { name: updates.name.trim() } : {}),
    ...(updates.type !== undefined ? { type: updates.type?.trim() || null } : {}),
    ...(updates.address !== undefined ? { address: updates.address?.trim() || null } : {}),
    ...(updates.remark !== undefined ? { remark: updates.remark?.trim() || null } : {}),
    ...(updates.isActive !== undefined ? { isActive: updates.isActive } : {}),
    updatedById: user!.id,
  });
  if (cas.outcome === "NOT_FOUND") return failNotFound(ERROR_CODES.NOT_FOUND, "仓库不存在");
  if (cas.outcome === "CONFLICT") return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");

  const updated = await prisma.warehouse.findFirst({ where: { id, deletedAt: null } });
  if (!updated) return failNotFound(ERROR_CODES.NOT_FOUND, "仓库不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "warehouse.update",
    entityType: "warehouse",
    entityId: id,
    beforeData: { name: existing.name, isActive: existing.isActive },
    afterData: { name: updated.name, isActive: updated.isActive },
    ...meta,
  });

  return ok(updated);
}

/**
 * DELETE /api/warehouses/:id（软删除）
 * 业务规则：被库位/业务单据引用（WarehouseReceipt / PurchaseReceipt / InventoryTransfer /
 * StockProjection / InventoryMovement 等）→ 409 不可删除，但可编辑；无引用 → 软删除。
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "warehouse:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "warehouse.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const warehouse = await prisma.warehouse.findFirst({ where: { id, deletedAt: null } });
  if (!warehouse) return failNotFound(ERROR_CODES.NOT_FOUND, "仓库不存在");

  // 引用检查：被库位或业务单据引用 → 不可删除（可编辑）
  const [locations, receipts, purchaseReceipts, transfers, projections, movements] = await Promise.all([
    prisma.warehouseLocation.count({ where: { warehouseId: id, deletedAt: null } }),
    prisma.warehouseReceipt.count({ where: { warehouseId: id, deletedAt: null } }),
    prisma.purchaseReceipt.count({ where: { warehouseId: id, deletedAt: null } }),
    prisma.inventoryTransfer.count({ where: { OR: [{ sourceWarehouseId: id }, { destinationWarehouseId: id }], deletedAt: null } }),
    prisma.stockProjection.count({ where: { warehouseId: id } }),
    prisma.inventoryMovement.count({ where: { warehouseId: id } }),
  ]);
  // 引用出处（问题二）：条数 + 真实库位/单据编号（库存投影与流水以物料编号定位）
  const references = await collectReferences([
    {
      entity: "库位",
      count: () => Promise.resolve(locations),
      samples: async () =>
        (
          await prisma.warehouseLocation.findMany({
            where: { warehouseId: id, deletedAt: null },
            take: REFERENCE_SAMPLE_LIMIT,
            orderBy: { code: "asc" },
            select: { code: true },
          })
        ).map((l) => l.code),
      releaseHint: "先删除该仓库下的库位",
    },
    {
      entity: "入库单",
      count: () => Promise.resolve(receipts),
      samples: async () =>
        (
          await prisma.warehouseReceipt.findMany({
            where: { warehouseId: id, deletedAt: null },
            take: REFERENCE_SAMPLE_LIMIT,
            orderBy: { createdAt: "desc" },
            select: { code: true },
          })
        ).map((r) => r.code),
      releaseHint: "先回退/删除对应入库单",
    },
    {
      entity: "收货单",
      count: () => Promise.resolve(purchaseReceipts),
      samples: async () =>
        (
          await prisma.purchaseReceipt.findMany({
            where: { warehouseId: id, deletedAt: null },
            take: REFERENCE_SAMPLE_LIMIT,
            orderBy: { createdAt: "desc" },
            select: { code: true },
          })
        ).map((r) => r.code),
      releaseHint: "先回退/删除对应收货单",
    },
    {
      entity: "库存调拨单",
      count: () => Promise.resolve(transfers),
      samples: async () =>
        (
          await prisma.inventoryTransfer.findMany({
            where: { OR: [{ sourceWarehouseId: id }, { destinationWarehouseId: id }], deletedAt: null },
            take: REFERENCE_SAMPLE_LIMIT,
            orderBy: { createdAt: "desc" },
            select: { transferNo: true },
          })
        ).map((t) => t.transferNo),
      releaseHint: "先删除对应调拨单",
    },
    {
      entity: "库存投影（物料）",
      count: () => Promise.resolve(projections),
      samples: async () =>
        (
          await prisma.stockProjection.findMany({
            where: { warehouseId: id },
            take: REFERENCE_SAMPLE_LIMIT,
            select: { item: { select: { code: true } } },
          })
        ).map((p) => p.item.code),
      releaseHint: "该仓库仍有库存余额投影（余额事实，需先清空库存）",
    },
    {
      entity: "库存流水",
      count: () => Promise.resolve(movements),
      samples: async () =>
        (
          await prisma.inventoryMovement.findMany({
            where: { warehouseId: id },
            take: REFERENCE_SAMPLE_LIMIT,
            orderBy: { committedAt: "desc" },
            select: { movementNo: true },
          })
        ).map((m) => m.movementNo),
      releaseHint: "库存流水为不可变事实（保持库存溯源）",
    },
  ]);
  if (references.length > 0) {
    return failReferenceConflict(
      ERROR_CODES.CONFLICT,
      `仓库「${warehouse.code} ${warehouse.name}」`,
      references,
    );
  }

  const updated = await prisma.warehouse.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "warehouse.delete",
    entityType: "warehouse",
    entityId: id,
    afterData: { code: updated.code, deleted: true },
    ...meta,
  });

  return ok({ id, deleted: true });
}
