import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { ratingRank, CUSTOMER_LEVEL_LABELS } from "@/lib/supplier-rating";

export const dynamic = "force-dynamic";

/**
 * GET /api/sales-orders/:id/supplier-recommendations — 推荐供应商投影（Q 线，只读）
 *
 * 依据（cc-06 客户等级→供应商评级匹配）：
 *   SalesOrder.customerId → BusinessPartner.customerLevel → CustomerSupplierRatingRule（isActive）
 *   → 过滤：供应商 PartnerCredit.rating ≥ minimumSupplierRating（无规则/客户未设等级 = 不设门槛，展示全部）
 *   → 排序：优选供应商优先（SupplierItem.isPreferred 计数降序）→ 供应商评级降序 → 覆盖商品数降序
 * 页面必须展示返回的 basis 说明；用户仍可人工选择供应商（不建 Matching Engine / 复杂评分）。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "sales-order:view");
  if (denied) return denied;
  requestLog(request, user?.id, "sales-order.supplier-recommendations");

  const { id } = await params;
  const salesOrder = await prisma.salesOrder.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      customerId: true,
      customer: { select: { id: true, customerLevel: true } },
    },
  });
  if (!salesOrder) return failNotFound(ERROR_CODES.SALES_ORDER_NOT_FOUND, "销售订单不存在");

  const customerLevel = salesOrder.customer?.customerLevel ?? null;

  // 匹配规则：客户等级 → 最低供应商评级（专用配置模型；无规则 = 不设门槛，默认展示全部）
  const rule =
    customerLevel === null
      ? null
      : await prisma.customerSupplierRatingRule.findFirst({
          where: { customerLevel, isActive: true, deletedAt: null },
          select: { customerLevel: true, minimumSupplierRating: true },
        });

  const lines = await prisma.salesOrderLine.findMany({
    where: { salesOrderId: id, deletedAt: null },
    select: { itemId: true },
  });
  const itemIds = [...new Set(lines.map((l) => l.itemId).filter((x): x is string => x !== null))];
  if (itemIds.length === 0) {
    return ok({
      rows: [],
      customerLevel,
      minimumSupplierRating: rule?.minimumSupplierRating ?? null,
      ruleApplied: rule !== null,
      basis: buildBasis(customerLevel, rule?.minimumSupplierRating ?? null, rule !== null),
    });
  }

  const supplierItems = await prisma.supplierItem.findMany({
    where: { itemId: { in: itemIds }, deletedAt: null, isActive: true },
    include: {
      supplier: {
        select: {
          id: true,
          code: true,
          name: true,
          creditRating: true,
          settlementTerms: true,
          isActive: true,
          partnerCredit: { select: { rating: true } },
        },
      },
    },
  });

  // 按供应商聚合：出现次数 + 是否优选 + 供应商评级（PartnerCredit.rating canonical；无评级 = 0）
  const agg = new Map<string, { supplier: (typeof supplierItems)[number]["supplier"]; itemCount: number; preferredCount: number; totalPrice: number }>();
  for (const si of supplierItems) {
    if (!si.supplier?.isActive) continue;
    const cur = agg.get(si.supplier.id) ?? { supplier: si.supplier, itemCount: 0, preferredCount: 0, totalPrice: 0 };
    cur.itemCount += 1;
    if (si.isPreferred) cur.preferredCount += 1;
    cur.totalPrice += Number(si.purchasePrice ?? 0);
    agg.set(si.supplier.id, cur);
  }

  let rows = [...agg.values()];

  // 规则命中：仅保留满足评级门槛的供应商（无 PartnerCredit.rating 视为不满足）
  if (rule) {
    const minRank = ratingRank(rule.minimumSupplierRating);
    rows = rows.filter((a) => ratingRank(a.supplier.partnerCredit?.rating ?? null) >= minRank);
  }

  rows.sort(
    (a, b) =>
      b.preferredCount - a.preferredCount ||
      ratingRank(b.supplier.partnerCredit?.rating ?? null) - ratingRank(a.supplier.partnerCredit?.rating ?? null) ||
      b.itemCount - a.itemCount,
  );

  return ok({
    rows: rows.map((a) => ({
      supplierId: a.supplier.id,
      supplierCode: a.supplier.code,
      supplierName: a.supplier.name,
      creditRating: a.supplier.creditRating,
      supplierRating: a.supplier.partnerCredit?.rating ?? null,
      settlementTerms: a.supplier.settlementTerms,
      itemCount: a.itemCount,
      preferredCount: a.preferredCount,
      totalPrice: a.totalPrice,
    })),
    customerLevel,
    minimumSupplierRating: rule?.minimumSupplierRating ?? null,
    ruleApplied: rule !== null,
    basis: buildBasis(customerLevel, rule?.minimumSupplierRating ?? null, rule !== null),
  });
}

/** 推荐依据文案（页面必须展示；用户仍可人工选择） */
function buildBasis(customerLevel: string | null, minimumSupplierRating: string | null, ruleApplied: boolean): string {
  if (!ruleApplied) {
    if (customerLevel === null) {
      return "推荐依据：客户未设置等级，无评级门槛（展示全部匹配供应商）；优选供应商优先，评级高者优先。用户仍可人工选择。";
    }
    return `推荐依据：客户等级 ${customerLevel} 未配置评级规则（展示全部匹配供应商）；优选供应商优先，评级高者优先。用户仍可人工选择。`;
  }
  const levelLabel = CUSTOMER_LEVEL_LABELS[customerLevel ?? ""] ?? customerLevel ?? "";
  return `推荐依据：客户等级 ${levelLabel}，要求供应商评级 ≥ ${minimumSupplierRating}，优选供应商优先；评级相同则按供应商评级降序。用户仍可人工选择。`;
}
