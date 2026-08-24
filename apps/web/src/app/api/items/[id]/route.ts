import { NextRequest } from "next/server";
import type { ItemType, ItemStatus, ItemLifecycle } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { casUpdate } from "@/lib/api/cas";
import { z } from "zod";

export const dynamic = "force-dynamic";

const itemUpdateSchema = z
  .object({
    code: z.string().min(1).max(64).optional(),
    mnemonic: z.string().max(50).nullable().optional(),
    name: z.string().min(1).max(200).optional(),
    itemType: z.enum(["FINISHED_GOOD", "RAW_MATERIAL", "SEMI_FINISHED", "PURCHASED_PART", "ACCESSORY", "SERVICE", "CONSUMABLE", "ASSET", "TOOLING", "PACKAGING"]).optional(),
    sourcingType: z.enum(["BOUGHT", "SELF_MANUFACTURED", "OEM_OUTSOURCED"]).optional(),
    categoryId: z.string().min(1).nullable().optional(),
    series: z.string().max(100).nullable().optional(),
    model: z.string().max(100).nullable().optional(),
    variant: z.string().max(100).nullable().optional(),
    spec: z.string().max(500).nullable().optional(),
    brand: z.string().max(100).nullable().optional(),
    manufacturer: z.string().max(200).nullable().optional(),
    oemCode: z.string().max(100).nullable().optional(),
    barcode: z.string().max(100).nullable().optional(),
    qrCode: z.string().max(200).nullable().optional(),
    drawingNo: z.string().max(100).nullable().optional(),
    drawingVersion: z.string().max(50).nullable().optional(),
    revision: z.string().max(50).nullable().optional(),
    lifecycle: z.enum(["DESIGN", "TRIAL", "MASS_PRODUCTION", "DISCONTINUED", "OBSOLETE"]).nullable().optional(),
    status: z.enum(["ACTIVE", "INACTIVE", "LOCKED", "ARCHIVED"]).optional(),
    stockUomId: z.string().min(1).nullable().optional(),
    purchaseUomId: z.string().min(1).nullable().optional(),
    salesUomId: z.string().min(1).nullable().optional(),
    isSalable: z.boolean().optional(),
    isPurchasable: z.boolean().optional(),
    isManufacturable: z.boolean().optional(),
    description: z.string().max(1000).nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/items/:id（详情含分类/多 UOM/规格/成本/供应商/版本/标签/标准） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item:view");
  if (denied) return denied;
  requestLog(request, user?.id, "item.get");

  const { id } = await params;
  const item = await prisma.item.findFirst({
    where: { id, deletedAt: null },
    include: {
      category: true,
      unit: { select: { id: true, code: true, name: true, symbol: true } },
      stockUom: { select: { id: true, code: true, name: true, symbol: true } },
      purchaseUom: { select: { id: true, code: true, name: true, symbol: true } },
      salesUom: { select: { id: true, code: true, name: true, symbol: true } },
      linearGuide: true,
      standards: { where: { createdAt: { not: undefined } }, include: { standard: { select: { id: true, code: true, name: true } } } },
      specifications: { where: { deletedAt: null }, orderBy: [{ sort: "asc" }, { specKey: "asc" }] },
      uomConversions: { where: { deletedAt: null }, include: { fromUom: { select: { id: true, code: true, name: true } }, toUom: { select: { id: true, code: true, name: true } } } },
      costs: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
      supplierItems: { where: { deletedAt: null }, include: { supplier: { select: { id: true, code: true, name: true } } } },
      revisions: { where: { deletedAt: null }, orderBy: { revisionNo: "desc" } },
      tags: { where: { deletedAt: null }, include: { tag: { select: { id: true, code: true, name: true, color: true } } } },
      // P-1B 产品/原料合同视图（只读聚合；复用权威模型，零字段复制）
      bomFinished: { where: { deletedAt: null }, orderBy: { bomVersion: "desc" }, select: { id: true, bomNo: true, bomVersion: true, status: true, isDefault: true } }, // 产品：作为成品的配方
      bomComponents: { where: { deletedAt: null }, select: { id: true, bom: { select: { id: true, bomNo: true, finishedItem: { select: { id: true, code: true, name: true } } } } } }, // 原料：被哪些配方使用
      costBalance: true, // 库存成本（移动加权平均，ADR-0038）
      productionOrderFinished: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, orderNo: true, productionType: true, status: true, plannedQty: true } }, // 生产/外协工单
      stockProjections: { select: { warehouseId: true, warehouse: { select: { code: true, name: true } }, onHandQty: true } }, // 库存余额（StockProjection SSOT，只读）
      partnerPrices: { where: { deletedAt: null }, include: { priceList: { select: { id: true, name: true } } } }, // 供应商/客户价格
    },
  });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "物料不存在");
  return ok(item);
}

/** PATCH /api/items/:id（乐观锁 version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "item.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = itemUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.item.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "物料不存在");

  // 原子乐观锁（审计 P1：updateMany where {id,version} + count 判定）
  const cas = await casUpdate(prisma, 'item', id, version, {
    ...updates,
    itemType: updates.itemType as ItemType | undefined,
    lifecycle: updates.lifecycle === undefined ? undefined : (updates.lifecycle as ItemLifecycle | null),
    status: updates.status as ItemStatus | undefined,
    updatedById: user!.id,
  });
  if (cas.outcome === 'NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, "物料不存在");
  if (cas.outcome === 'CONFLICT') return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  const updated = await prisma.item.findFirst({ where: { id, deletedAt: null } });
  if (!updated) return failNotFound(ERROR_CODES.NOT_FOUND, "物料不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "item.update",
    entityType: "item",
    entityId: id,
    beforeData: { name: existing.name, itemType: existing.itemType, status: existing.status },
    afterData: { name: updated.name, itemType: updated.itemType, status: updated.status },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/items/:id（软删除；有交易引用时拒绝） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "item.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const item = await prisma.item.findFirst({ where: { id, deletedAt: null } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "物料不存在");

  const refs = await prisma.item.findFirst({
    where: { id },
    include: { _count: { select: { priceListItems: true, projectProducts: true } } },
  });
  if (refs && (refs._count.priceListItems > 0 || refs._count.projectProducts > 0)) {
    return failConflict(ERROR_CODES.CONFLICT, "物料已被价格表或项目引用，不能删除");
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.itemSpecification.updateMany({ where: { itemId: id, deletedAt: null }, data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null } });
    await tx.uomConversion.updateMany({ where: { itemId: id, deletedAt: null }, data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null } });
    await tx.itemCost.updateMany({ where: { itemId: id, deletedAt: null }, data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null } });
    await tx.supplierItem.updateMany({ where: { itemId: id, deletedAt: null }, data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null } });
    await tx.itemRevision.updateMany({ where: { itemId: id, deletedAt: null }, data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null } });
    await tx.itemTag.updateMany({ where: { itemId: id, deletedAt: null }, data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null } });
    await tx.item.update({ where: { id }, data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null } });
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "item.delete",
    entityType: "item",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
