import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { requestLog } from "@/lib/api/logger";
import { ok, fail } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { resolveSupplierPriceSnapshot } from "@/lib/purchase-order/helpers";

export const dynamic = "force-dynamic";

/**
 * GET /api/purchase-requisitions/:id/price-suggestions?supplierId= — PR → PO 转换价格通道建议
 * （用户指令 2026-08-21 价格通道整理：修复转单死胡同——无供应商价格快照时提示改用 MANUAL 通道，但对话框无 MANUAL 入口）
 *
 * 设计：
 *  - 服务端权威解析（与 convert/PO PATCH 完全同语义，复用 resolveSupplierPriceSnapshot）：
 *    partnerId=supplier.partnerId + itemId + priceSource=SUPPLIER + isActive + deletedAt=null，priority asc；
 *  - 命中 → snapshot={partnerPriceId, unitPrice, taxRate}（转单走 SUPPLIER_PRICE_SNAPSHOT）；
 *    未命中 → snapshot=null（前端引导该行 MANUAL 通道：unitPrice + priceReason 必填，审计 priceSetBy/priceSetAt 由 convert 写入）；
 *  - PR Line 无 itemId → snapshot 恒为 null（MANUAL 通道仍可转单，见 convert MANUAL 分支）。
 *  - 权限：purchase-requisition:approve（与 convert 一致；对话框仅 canApprove 可见）。
 *  - 只读、无副作用、不校验 PR 状态（建议服务于转换动作本身）。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "purchase-requisition:approve");
  if (denied) return denied;
  requestLog(request, user?.id, "purchase-requisition.price-suggestions");

  const { id } = await params;
  const supplierId = new URL(request.url).searchParams.get("supplierId")?.trim();
  if (!supplierId) {
    return fail(ERROR_CODES.VALIDATION_ERROR, "缺少 supplierId", 400);
  }

  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, deletedAt: null },
    select: { id: true, partnerId: true },
  });
  if (!supplier) {
    return fail(ERROR_CODES.PURCHASE_ORDER_SUPPLIER_NOT_FOUND, "供应商不存在", 400);
  }

  const pr = await prisma.purchaseRequisition.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!pr) {
    return fail(ERROR_CODES.PURCHASE_REQUISITION_NOT_FOUND, "采购申请不存在", 404);
  }

  const lines = await prisma.purchaseRequisitionLine.findMany({
    where: { purchaseRequisitionId: id, deletedAt: null },
    orderBy: { lineNo: "asc" },
    include: {
      item: {
        select: {
          id: true,
          code: true,
          name: true,
          // 商品优选供应商行（SupplierItem；ADR-0012 §9；采购自动引用采购价/供应商/付款条款）
          supplierItems: {
            where: { deletedAt: null },
            orderBy: [{ isPreferred: "desc" }, { createdAt: "desc" }],
            take: 1,
            select: { supplierId: true, purchasePrice: true, paymentTerm: true },
          },
        },
      },
      uom: { select: { symbol: true } },
    },
  });

  const suggestions = [];
  for (const line of lines) {
    let snapshot = null;
    if (supplier.partnerId && line.itemId) {
      const snap = await resolveSupplierPriceSnapshot(prisma, {
        partnerId: supplier.partnerId,
        itemId: line.itemId,
      });
      if (snap) {
        snapshot = {
          partnerPriceId: snap.partnerPriceId,
          unitPrice: snap.unitPrice.toString(),
          taxRate: snap.taxRate.toString(),
        };
      }
    }
    suggestions.push({
      lineId: line.id,
      lineNo: line.lineNo,
      itemId: line.itemId,
      itemCode: line.item?.code ?? null,
      itemName: line.item?.name ?? null,
      description: line.description,
      quantity: line.quantity.toString(),
      uomSymbol: line.uom?.symbol ?? null,
      snapshot,
      // 商品优选供应商行采购信息（用户指令 2026-08-21：无快照时预填采购价；供应商/付款条款自动带出）
      itemSupplierId: line.item?.supplierItems?.[0]?.supplierId ?? null,
      itemPurchasePrice: line.item?.supplierItems?.[0]?.purchasePrice?.toString() ?? null,
      itemPaymentTerm: line.item?.supplierItems?.[0]?.paymentTerm ?? null,
    });
  }

  return ok({ supplierId, lines: suggestions });
}
