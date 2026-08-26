import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/sales-orders/:id/material-requirements — BOM 预计用料投影（Q 线，只读）
 *
 * 算法：订单行 quantity × ItemBomLine.qtyPerFinishedUnit × (1 + lossRate) → 按原料汇总；
 * 成品取 ACTIVE 默认配方（ItemBom status=ACTIVE 且 isDefault=true；无默认取任一 ACTIVE）。
 * 输出含当前库存（StockProjection SSOT，禁止前端自拼余额）。
 *
 * 吨数折算（本线：统一 TON 展示）：
 * 只消费现有 UomConversion 事实（1 from = factor to，CTO #2075；不重写 BOM 算法、不前端换算）。
 *  - 目标 TON 单位 = UnitOfMeasure(code=TON 或 name=吨)；
 *  - requiredUom → TON 存在换算：正向（from=requiredUom, to=TON）tonnage = requiredQty × factor；
 *    反向（from=TON, to=requiredUom）tonnage = requiredQty ÷ factor；
 *  - 无 TON 单位或无换算 → 不猜：tonnage=null、tonnageConvertible=false、reason 说明缺失事实。
 *
 * 红线：只读投影，不自动下采购单/不预留/不 MRP（HOLD）。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "sales-order:view");
  if (denied) return denied;
  requestLog(request, user?.id, "sales-order.material-requirements");

  const { id } = await params;
  const salesOrder = await prisma.salesOrder.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!salesOrder) return failNotFound(ERROR_CODES.SALES_ORDER_NOT_FOUND, "销售订单不存在");

  const lines = await prisma.salesOrderLine.findMany({
    where: { salesOrderId: id, deletedAt: null },
    select: { itemId: true, quantity: true },
  });

  const itemIds = [...new Set(lines.map((l) => l.itemId).filter((x): x is string => x !== null))];
  // 成品 → 默认 ACTIVE 配方
  const boms = await prisma.itemBom.findMany({
    where: { finishedItemId: { in: itemIds }, status: "ACTIVE", deletedAt: null },
    select: { id: true, finishedItemId: true, isDefault: true },
  });
  const bomByItem = new Map<string, string>();
  for (const b of boms) {
    if (!bomByItem.has(b.finishedItemId)) bomByItem.set(b.finishedItemId, b.id);
    if (b.isDefault) bomByItem.set(b.finishedItemId, b.id);
  }

  const bomIds = [...bomByItem.values()];
  const bomLines = bomIds.length
    ? await prisma.itemBomLine.findMany({
        where: { bomId: { in: bomIds }, deletedAt: null },
        select: { bomId: true, componentItemId: true, qtyPerFinishedUnit: true, lossRate: true },
      })
    : [];

  // 汇总原料需求
  const need = new Map<string, { qty: number; bomId: string }>();
  for (const l of lines) {
    if (!l.itemId) continue;
    const bomId = bomByItem.get(l.itemId);
    if (!bomId) continue;
    const orderQty = Number(l.quantity);
    for (const bl of bomLines) {
      if (bl.bomId !== bomId) continue;
      const req = orderQty * Number(bl.qtyPerFinishedUnit) * (1 + Number(bl.lossRate));
      const cur = need.get(bl.componentItemId);
      need.set(bl.componentItemId, { qty: (cur?.qty ?? 0) + req, bomId });
    }
  }

  const componentIds = [...need.keys()];

  // TON 目标单位（code=TON 或 name=吨）；不存在 → 整条投影不可换算（不猜，reason 说明）
  const tonUom = await prisma.unitOfMeasure.findFirst({
    where: { OR: [{ code: "TON" }, { name: "吨" }], deletedAt: null },
    select: { id: true, code: true },
  });

  const [items, stockRows, conversions] = await Promise.all([
    prisma.item.findMany({
      where: { id: { in: componentIds } },
      select: {
        id: true,
        code: true,
        name: true,
        stockUom: { select: { id: true, code: true, name: true } },
      },
    }),
    prisma.stockProjection.findMany({
      where: { itemId: { in: componentIds } },
      select: { itemId: true, onHandQty: true },
    }),
    tonUom
      ? prisma.uomConversion.findMany({
          where: { itemId: { in: componentIds }, deletedAt: null },
          select: { itemId: true, fromUomId: true, toUomId: true, factor: true },
        })
      : Promise.resolve([]),
  ]);
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const stockMap = new Map<string, number>();
  for (const s of stockRows) {
    stockMap.set(s.itemId, (stockMap.get(s.itemId) ?? 0) + Number(s.onHandQty));
  }

  const rows = componentIds.map((cid) => {
    const it = itemMap.get(cid);
    const requiredUomCode = it?.stockUom?.code ?? null;
    const stockUomId = it?.stockUom?.id ?? null;
    const reqQty = need.get(cid)!.qty;

    let tonnage: number | null = null;
    let tonnageConvertible = false;
    let reason: string | null = null;
    if (!tonUom) {
      reason = "缺少 TON 计量单位（无法换算）";
    } else if (!stockUomId) {
      reason = "原料缺少库存计量单位，无法换算";
    } else {
      // 正向：requiredUom → TON（1 from = factor to → qty × factor）
      const direct = conversions.find(
        (c) => c.itemId === cid && c.fromUomId === stockUomId && c.toUomId === tonUom.id,
      );
      // 反向：TON → requiredUom（1 from = factor to → qty ÷ factor）
      const reverse = conversions.find(
        (c) => c.itemId === cid && c.fromUomId === tonUom.id && c.toUomId === stockUomId,
      );
      if (direct) {
        tonnage = new Prisma.Decimal(reqQty)
          .mul(new Prisma.Decimal(direct.factor.toString()))
          .toNumber();
        tonnageConvertible = true;
      } else if (reverse) {
        tonnage = new Prisma.Decimal(reqQty)
          .div(new Prisma.Decimal(reverse.factor.toString()))
          .toNumber();
        tonnageConvertible = true;
      } else {
        reason = `缺少 ${requiredUomCode} → TON 换算`;
      }
    }

    return {
      itemId: cid,
      itemCode: it?.code ?? null,
      itemName: it?.name ?? null,
      uom: it?.stockUom?.name ?? it?.stockUom?.code ?? null,
      requiredUom: requiredUomCode,
      requiredQty: reqQty,
      tonnage,
      tonnageConvertible,
      reason,
      onHandQty: stockMap.get(cid) ?? 0,
    };
  });

  return ok(rows);
}
