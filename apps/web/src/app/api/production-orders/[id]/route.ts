import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, failServer } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";
import { resolveMaterialLines } from "@/lib/production-order/helpers";

export const dynamic = "force-dynamic";

const materialLineSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.coerce.number().positive(),
  uomId: z.string().nullable().optional(),
  warehouseId: z.string().min(1),
});

const productionOrderUpdateSchema = z.object({
  version: z.coerce.number().int().positive(),
  plannedQty: z.coerce.number().positive(),
  warehouseId: z.string().min(1),
  bomId: z.string().nullable().optional(),
  materialWarehouseId: z.string().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  processingFee: z.coerce.number().min(0).nullable().optional(),
  batchNo: z.string().max(100).nullable().optional(),
  productionDate: z.string().datetime().nullable().optional(),
  remark: z.string().max(1000).nullable().optional(),
  materialLines: z.array(materialLineSchema).optional(),
});

/** GET /api/production-orders/:id（详情 + 行） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "production-order:view");
  if (denied) return denied;
  requestLog(request, user?.id, "production-order.get");
  const { id } = await params;

  const order = await prisma.productionOrder.findFirst({
    where: { id, deletedAt: null },
    include: {
      finishedItem: { select: { id: true, code: true, name: true, model: true, itemType: true, sourcingType: true, stockUomId: true } },
      warehouse: { select: { id: true, code: true, name: true } },
      supplier: { select: { id: true, code: true, name: true } },
      bom: { select: { id: true, bomNo: true, bomVersion: true, status: true } },
      lines: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        include: {
          item: { select: { id: true, code: true, name: true, stockUomId: true } },
          uom: { select: { id: true, code: true, symbol: true } },
          warehouse: { select: { id: true, code: true, name: true } },
        },
      },
    },
  });
  if (!order) return failNotFound(ERROR_CODES.PRODUCTION_ORDER_NOT_FOUND, "工单不存在");
  return ok(order);
}

/** PATCH /api/production-orders/:id（仅 DRAFT；CAS；头字段 + 行整体重建） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "production-order:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "production-order.update");
  const { id } = await params;
  const meta = requestMeta(request);

  const parsed = productionOrderUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const actorId = user!.id;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findFirst({ where: { id, deletedAt: null } });
      if (!order) throw new Error("NOT_FOUND");
      if (order.status !== "DRAFT") throw new Error("INVALID_STATE");
      if (order.version !== parsed.data.version) throw new Error("VERSION_CONFLICT");

      // 成品/仓库/OEM 校验（同创建）
      const finished = await tx.item.findFirst({ where: { id: order.finishedItemId, deletedAt: null } });
      if (!finished || !finished.stockUomId) throw new Error("ITEM_INVALID");
      const wh = await tx.warehouse.findFirst({ where: { id: parsed.data.warehouseId, deletedAt: null } });
      if (!wh) throw new Error("WAREHOUSE_INVALID");
      if (order.productionType === "OEM_OUTSOURCING") {
        if (!parsed.data.supplierId) throw new Error("SUPPLIER_INVALID");
        const supplier = await tx.businessPartner.findFirst({ where: { id: parsed.data.supplierId, deletedAt: null } });
        if (!supplier || (supplier.type !== "SUPPLIER" && supplier.type !== "BOTH")) throw new Error("SUPPLIER_INVALID");
        if (parsed.data.processingFee == null || parsed.data.processingFee < 0) throw new Error("FEE_INVALID");
      }

      const plannedQty = new Prisma.Decimal(parsed.data.plannedQty);
      const materialLines = await resolveMaterialLines(tx, {
        bomId: parsed.data.bomId ?? null,
        finishedItemId: order.finishedItemId,
        plannedQty,
        materialWarehouseId: parsed.data.materialWarehouseId ?? parsed.data.warehouseId,
        manualLines: parsed.data.materialLines ?? [],
      });

      const cas = await tx.productionOrder.updateMany({
        where: { id, version: parsed.data.version, status: "DRAFT", deletedAt: null },
        data: {
          bomId: parsed.data.bomId ?? null,
          plannedQty,
          warehouseId: parsed.data.warehouseId,
          supplierId: order.productionType === "OEM_OUTSOURCING" ? parsed.data.supplierId! : null,
          processingFee: order.productionType === "OEM_OUTSOURCING" ? new Prisma.Decimal(parsed.data.processingFee ?? 0) : null,
          batchNo: parsed.data.batchNo ?? null,
          productionDate: parsed.data.productionDate ? new Date(parsed.data.productionDate) : null,
          remark: parsed.data.remark ?? null,
          updatedById: actorId,
          version: { increment: 1 },
        },
      });
      if (cas.count !== 1) throw new Error("VERSION_CONFLICT");

      // 行整体重建（DRAFT 未生效，安全）
      await tx.productionOrderLine.deleteMany({ where: { orderId: id } });
      await tx.productionOrderLine.createMany({
        data: [
          ...materialLines.map((m) => ({
            orderId: id,
            lineType: "MATERIAL" as const,
            itemId: m.itemId,
            uomId: m.uomId,
            quantity: m.quantity,
            warehouseId: m.warehouseId,
            createdById: actorId,
            updatedById: actorId,
            remark: parsed.data.bomId ? "BOM 配方计算" : null,
          })),
          {
            orderId: id,
            lineType: "FINISHED" as const,
            itemId: order.finishedItemId,
            uomId: finished.stockUomId,
            quantity: plannedQty,
            warehouseId: null,
            createdById: actorId,
            updatedById: actorId,
            remark: "成品产出",
          },
        ],
      });

      return tx.productionOrder.findFirstOrThrow({
        where: { id, deletedAt: null },
        include: { lines: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } } },
      });
    });

    await writeAuditLog({ actorId, action: "production-order.update", entityType: "productionOrder", entityId: id, afterData: { orderNo: updated.orderNo, status: updated.status, version: updated.version }, ...meta });
    return ok(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return failNotFound(ERROR_CODES.PRODUCTION_ORDER_NOT_FOUND, "工单不存在");
    if (msg === "INVALID_STATE") return failConflict(ERROR_CODES.PRODUCTION_ORDER_INVALID_STATE, "仅 DRAFT 状态可编辑");
    if (msg === "VERSION_CONFLICT") return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
    if (msg === "ITEM_INVALID") return failConflict(ERROR_CODES.PRODUCTION_ORDER_ITEM_INVALID, "物料不存在/已停用或缺少库存单位");
    if (msg === "WAREHOUSE_INVALID") return failConflict(ERROR_CODES.PRODUCTION_ORDER_WAREHOUSE_INVALID, "仓库不存在或已停用");
    if (msg === "SUPPLIER_INVALID") return failConflict(ERROR_CODES.PRODUCTION_ORDER_SUPPLIER_INVALID, "OEM 必须选择供应商类型的外协厂");
    if (msg === "FEE_INVALID") return failConflict(ERROR_CODES.PRODUCTION_ORDER_FEE_INVALID, "OEM 加工费必须 >= 0");
    if (msg === "BOM_INVALID") return failConflict(ERROR_CODES.PRODUCTION_ORDER_BOM_INVALID, "配方不存在/非生效状态/不属于本成品");
    if (msg === "UOM_INVALID") return failConflict(ERROR_CODES.PRODUCTION_ORDER_UOM_INVALID, "物料行单位必须 = 物料库存单位");
    if (msg === "NO_LINES") return failConflict(ERROR_CODES.PRODUCTION_ORDER_NO_LINES, "至少需要一行物料（手工模式）");
    if (msg === "LINE_INVALID") return failConflict(ERROR_CODES.PRODUCTION_ORDER_LINE_INVALID, "物料行数量必须 > 0");
    console.error("[production-order.update]", e);
    return failServer("更新生产/外协工单失败");
  }
}

/** DELETE /api/production-orders/:id（仅 DRAFT；软删头+行） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "production-order:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "production-order.delete");
  const { id } = await params;
  const meta = requestMeta(request);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findFirst({ where: { id, deletedAt: null } });
      if (!order) throw new Error("NOT_FOUND");
      if (order.status !== "DRAFT") throw new Error("INVALID_STATE");
      const now = new Date();
      await tx.productionOrder.update({ where: { id }, data: { deletedAt: now, updatedById: user!.id, version: { increment: 1 } } });
      await tx.productionOrderLine.updateMany({ where: { orderId: id }, data: { deletedAt: now } });
      return order;
    });
    await writeAuditLog({ actorId: user!.id, action: "production-order.delete", entityType: "productionOrder", entityId: id, afterData: { orderNo: result.orderNo }, ...meta });
    return ok({ id, deleted: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return failNotFound(ERROR_CODES.PRODUCTION_ORDER_NOT_FOUND, "工单不存在");
    if (msg === "INVALID_STATE") return failConflict(ERROR_CODES.PRODUCTION_ORDER_INVALID_STATE, "仅 DRAFT 状态可删除");
    console.error("[production-order.delete]", e);
    return failServer("删除工单失败");
  }
}
