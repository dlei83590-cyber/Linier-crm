import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/sales-orders/:id/supplier-recommendations — 推荐供应商投影（Q 线，只读）
 *
 * 依据：订单行商品 → SupplierItem（isPreferred 优先）→ 供应商 BusinessPartner（creditRating 高者优先）。
 * 用户仍可人工选择供应商（不建 Matching Engine / 复杂评分）。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "sales-order:view");
  if (denied) return denied;
  requestLog(request, user?.id, "sales-order.supplier-recommendations");

  const { id } = await params;
  const salesOrder = await prisma.salesOrder.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, customerId: true },
  });
  if (!salesOrder) return failNotFound(ERROR_CODES.SALES_ORDER_NOT_FOUND, "销售订单不存在");

  const lines = await prisma.salesOrderLine.findMany({
    where: { salesOrderId: id, deletedAt: null },
    select: { itemId: true },
  });
  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  if (itemIds.length === 0) return ok([]);

  const supplierItems = await prisma.supplierItem.findMany({
    where: { itemId: { in: itemIds }, deletedAt: null, isActive: true },
    select: {
      id: true,
      itemId: true,
      isPreferred: true,
      purchasePrice: true,
      supplier: {
        select: {
          id: true,
          code: true,
          name: true,
          creditRating: true,
          settlementTerms: true,
          isActive: true,
        },
      },
    },
  });

  // 按供应商聚合：出现次数 + 是否优选 + creditRating 排序
  const agg = new Map<string, { supplier: (typeof supplierItems)[number]["supplier"]; itemCount: number; preferredCount: number; totalPrice: number }>();
  for (const si of supplierItems) {
    if (!si.supplier?.isActive) continue;
    const cur = agg.get(si.supplier.id) ?? { supplier: si.supplier, itemCount: 0, preferredCount: 0, totalPrice: 0 };
    cur.itemCount += 1;
    if (si.isPreferred) cur.preferredCount += 1;
    cur.totalPrice += Number(si.purchasePrice ?? 0);
    agg.set(si.supplier.id, cur);
  }

  const rows = [...agg.values()]
    .map((a) => ({
      supplierId: a.supplier.id,
      supplierCode: a.supplier.code,
      supplierName: a.supplier.name,
      creditRating: a.supplier.creditRating,
      settlementTerms: a.supplier.settlementTerms,
      itemCount: a.itemCount,
      preferredCount: a.preferredCount,
      totalPrice: a.totalPrice,
    }))
    .sort((a, b) => b.preferredCount - a.preferredCount || (b.creditRating ?? "").localeCompare(a.creditRating ?? ""));

  return ok(rows);
}
