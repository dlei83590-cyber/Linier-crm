import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { pricingEngineService, type PricingContext } from "@/lib/pricing/PricingEngineService";

/**
 * Sprint 4B - SalesOrderPricingService（销售订单重定价服务，CTO Final Review 阻断项①）
 * 背景：SalesOrderLine PATCH 之前错误复用了 quotationPricingService.priceLines()，
 *       把 SalesOrderLine.id 当作 QuotationLine.id 回写 QuotationPriceSnapshot.quotationLineId，
 *       污染价格追溯关系（严重时触发 FK 错误）。
 * 修复：SalesOrder 重定价走独立的 SalesOrderPricingService——只负责把 SalesOrder 上下文转换为
 *       PricingContext 并调用现有 PricingEngineService.resolvePrice()（不重新实现价格算法，ADR-0015），
 *       快照只回写 quotationId（来源报价，保持价格链可追溯），**绝不写 quotationLineId**。
 * 链路（CTO 锁定）：
 *   SalesOrderLine → PricingEngine.resolvePrice() → 新 QuotationPriceSnapshot（quotationId=来源报价）
 *   → SalesOrderLine.priceSnapshotId（sourceQuotationLineId 溯源保持不变）
 */

export interface SalesOrderPricingLineInput {
  lineId: string; // SalesOrderLine.id（仅用于结果映射，不回写 quotationLineId）
  itemId: string;
  quantity: number | Prisma.Decimal;
  uom?: string;
}

export interface SalesOrderPricingInput {
  quotationId: string; // 来源报价（快照 quotationId 回写，保持价格链溯源）
  customerId: string; // Customer.id（转 PricingContext.partnerId = customer.partnerId）
  currency: string;
  pricingDate: Date;
  taxProfileId?: string;
  taxIncluded?: boolean;
  lines: SalesOrderPricingLineInput[];
}

export interface SalesOrderPricingLineResult {
  lineId: string;
  priceSnapshotId: string;
  unitPrice: Prisma.Decimal; // 最终单价（含促销/币种，未税）
  discountRate: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  lineAmount: Prisma.Decimal; // 行未税金额
  taxAmount: Prisma.Decimal; // 行税额
  totalAmount: Prisma.Decimal; // 行含税金额
  currency: string;
  source: string;
}

export class SalesOrderPricingService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /** 逐行重定价：SalesOrder 上下文 → PricingContext → resolvePrice() → 回写快照 quotationId（不写 quotationLineId） */
  async priceLines(input: SalesOrderPricingInput): Promise<SalesOrderPricingLineResult[]> {
    // 客户 → Partner（PricingEngine 按 partnerId 命中 PartnerPrice）
    const customer = await this.db.customer.findFirst({ where: { id: input.customerId, deletedAt: null } });
    const partnerId = customer?.partnerId ?? undefined;

    const results: SalesOrderPricingLineResult[] = [];
    for (const line of input.lines) {
      const ctx: PricingContext = {
        partnerId,
        partnerRole: "CUSTOMER",
        itemId: line.itemId,
        quantity: typeof line.quantity === "number" ? line.quantity : Number(line.quantity),
        pricingDate: input.pricingDate,
        currency: input.currency,
        uom: line.uom,
        taxProfileId: input.taxProfileId,
        taxIncluded: input.taxIncluded,
      };

      const result = await pricingEngineService.resolvePrice(ctx);
      if (!result.snapshotId) throw new Error("PRICE_SNAPSHOT_MISSING");

      // 回写快照：仅 quotationId（来源报价）；禁止写 quotationLineId（CTO：SalesOrderLine.id 不得冒充 QuotationLine.id）
      await this.db.quotationPriceSnapshot.update({
        where: { id: result.snapshotId },
        data: { quotationId: input.quotationId },
      });

      const qty = typeof line.quantity === "number" ? new Prisma.Decimal(line.quantity) : line.quantity;
      const lineAmount = result.finalUnitPrice.mul(qty);
      const taxAmount = lineAmount.mul(result.taxRate).div(100);
      const totalAmount = lineAmount.add(taxAmount);

      results.push({
        lineId: line.lineId,
        priceSnapshotId: result.snapshotId,
        unitPrice: result.finalUnitPrice,
        discountRate: result.discountRate,
        taxRate: result.taxRate,
        lineAmount,
        taxAmount,
        totalAmount,
        currency: result.currency,
        source: result.source,
      });
    }
    return results;
  }
}

export const salesOrderPricingService = new SalesOrderPricingService();
