import { NextRequest } from "next/server";
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

  // 成品 → 默认 ACTIVE 配方
  const boms = await prisma.itemBom.findMany({
    where: { finishedItemId: { in: lines.map((l) => l.itemId) }, status: "ACTIVE", deletedAt: null },
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
  const [items, stockRows] = await Promise.all([
    prisma.item.findMany({
      where: { id: { in: componentIds } },
      select: { id: true, code: true, name: true, stockUom: { select: { code: true, name: true } } },
    }),
    prisma.stockProjection.findMany({
      where: { itemId: { in: componentIds }, deletedAt: null },
      select: { itemId: true, onHandQty: true },
    }),
  ]);
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const stockMap = new Map<string, number>();
  for (const s of stockRows) {
    stockMap.set(s.itemId, (stockMap.get(s.itemId) ?? 0) + Number(s.onHandQty));
  }

  const rows = componentIds.map((cid) => {
    const it = itemMap.get(cid);
    return {
      itemId: cid,
      itemCode: it?.code ?? null,
      itemName: it?.name ?? null,
      uom: it?.stockUom?.name ?? it?.stockUom?.code ?? null,
      requiredQty: need.get(cid)!.qty,
      onHandQty: stockMap.get(cid) ?? 0,
    };
  });

  return ok(rows);
}
