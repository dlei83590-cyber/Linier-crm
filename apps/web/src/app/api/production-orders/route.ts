import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import type { ProductionOrderStatus, ProductionOrderType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failServer, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";
import { nextOrderNo, resolveMaterialLines } from "@/lib/production-order/helpers";

export const dynamic = "force-dynamic";

const materialLineSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.coerce.number().positive(),
  uomId: z.string().nullable().optional(),
  warehouseId: z.string().min(1),
});

const productionOrderCreateSchema = z.object({
  productionType: z.enum(["SELF_MANUFACTURE", "OEM_OUTSOURCING"]).default("SELF_MANUFACTURE"),
  finishedItemId: z.string().min(1),
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

/** GET /api/production-orders（分页 + status/productionType/finishedItemId 过滤） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "production-order:view");
  if (denied) return denied;
  requestLog(request, user?.id, "production-order.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const status = searchParams.get("status")?.trim();
  const productionType = searchParams.get("productionType")?.trim();
  const finishedItemId = searchParams.get("finishedItemId")?.trim();

  const where = {
    deletedAt: null,
    ...(status ? { status: status as ProductionOrderStatus } : {}),
    ...(productionType ? { productionType: productionType as ProductionOrderType } : {}),
    ...(finishedItemId ? { finishedItemId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.productionOrder.count({ where }),
    prisma.productionOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        finishedItem: { select: { id: true, code: true, name: true, model: true, sourcingType: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        supplier: { select: { id: true, code: true, name: true } },
        _count: { select: { lines: true } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/production-orders（创建 DRAFT：orderNo 取号 + 物料行解析（BOM 驱动/手动）+ 成品行） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "production-order:create");
  if (denied) return denied;
  requestLog(request, user?.id, "production-order.create");

  const meta = requestMeta(request);
  const parsed = productionOrderCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const actorId = user!.id;

  try {
    const created = await prisma.$transaction(async (tx) => {
      // 成品校验（存在 + 库存单位）
      const finished = await tx.item.findFirst({ where: { id: parsed.data.finishedItemId, deletedAt: null } });
      if (!finished || !finished.stockUomId) throw new Error("ITEM_INVALID");
      // 成品仓库校验
      const wh = await tx.warehouse.findFirst({ where: { id: parsed.data.warehouseId, deletedAt: null } });
      if (!wh) throw new Error("WAREHOUSE_INVALID");
      // OEM 校验：必须选供应商且为供应商类型
      if (parsed.data.productionType === "OEM_OUTSOURCING") {
        if (!parsed.data.supplierId) throw new Error("SUPPLIER_INVALID");
        const supplier = await tx.businessPartner.findFirst({ where: { id: parsed.data.supplierId, deletedAt: null } });
        if (!supplier || (supplier.type !== "SUPPLIER" && supplier.type !== "BOTH")) throw new Error("SUPPLIER_INVALID");
        if (parsed.data.processingFee == null || parsed.data.processingFee < 0) throw new Error("FEE_INVALID");
      }

      // 物料行解析（BOM 驱动或手动）
      const plannedQty = new Prisma.Decimal(parsed.data.plannedQty);
      const materialLines = await resolveMaterialLines(tx, {
        bomId: parsed.data.bomId ?? null,
        finishedItemId: parsed.data.finishedItemId,
        plannedQty,
        materialWarehouseId: parsed.data.materialWarehouseId ?? parsed.data.warehouseId,
        manualLines: parsed.data.materialLines ?? [],
      });

      const orderNo = await nextOrderNo(tx);
      const order = await tx.productionOrder.create({
        data: {
          orderNo,
          productionType: parsed.data.productionType,
          bomId: parsed.data.bomId ?? null,
          finishedItemId: parsed.data.finishedItemId,
          plannedQty,
          warehouseId: parsed.data.warehouseId,
          supplierId: parsed.data.productionType === "OEM_OUTSOURCING" ? parsed.data.supplierId! : null,
          processingFee: parsed.data.productionType === "OEM_OUTSOURCING" ? new Prisma.Decimal(parsed.data.processingFee ?? 0) : null,
          batchNo: parsed.data.batchNo ?? null,
          productionDate: parsed.data.productionDate ? new Date(parsed.data.productionDate) : null,
          status: "DRAFT",
          remark: parsed.data.remark ?? null,
          createdById: actorId,
          updatedById: actorId,
          lines: {
            create: [
              ...materialLines.map((m) => ({
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
                lineType: "FINISHED" as const,
                itemId: parsed.data.finishedItemId,
                uomId: finished.stockUomId,
                quantity: plannedQty,
                warehouseId: null,
                createdById: actorId,
                updatedById: actorId,
                remark: "成品产出",
              },
            ],
          },
        },
        include: {
          lines: { orderBy: { createdAt: "asc" } },
          finishedItem: { select: { id: true, code: true, name: true } },
          warehouse: { select: { id: true, code: true, name: true } },
        },
      });
      return order;
    });

    await writeAuditLog({
      actorId,
      action: "production-order.create",
      entityType: "productionOrder",
      entityId: created.id,
      afterData: { orderNo: created.orderNo, status: created.status, plannedQty: created.plannedQty.toString() },
      ...meta,
    });
    return ok(created, undefined, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "ITEM_INVALID") return failConflict(ERROR_CODES.PRODUCTION_ORDER_ITEM_INVALID, "成品不存在/已停用或缺少库存单位");
    if (msg === "WAREHOUSE_INVALID") return failConflict(ERROR_CODES.PRODUCTION_ORDER_WAREHOUSE_INVALID, "仓库不存在或已停用");
    if (msg === "SUPPLIER_INVALID") return failConflict(ERROR_CODES.PRODUCTION_ORDER_SUPPLIER_INVALID, "OEM 必须选择供应商类型的外协厂");
    if (msg === "FEE_INVALID") return failConflict(ERROR_CODES.PRODUCTION_ORDER_FEE_INVALID, "OEM 加工费必须 >= 0");
    if (msg === "BOM_INVALID") return failConflict(ERROR_CODES.PRODUCTION_ORDER_BOM_INVALID, "配方不存在/非生效状态/不属于本成品");
    if (msg === "UOM_INVALID") return failConflict(ERROR_CODES.PRODUCTION_ORDER_UOM_INVALID, "物料行单位必须 = 物料库存单位");
    if (msg === "NO_LINES") return failConflict(ERROR_CODES.PRODUCTION_ORDER_NO_LINES, "至少需要一行物料（手工模式）");
    if (msg === "LINE_INVALID") return failConflict(ERROR_CODES.PRODUCTION_ORDER_LINE_INVALID, "物料行数量必须 > 0");
    console.error("[production-order.create]", e);
    return failServer("创建生产/外协工单失败");
  }
}
