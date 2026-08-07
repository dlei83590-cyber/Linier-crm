import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { pricingEngineService, type PricingContext } from "@/lib/pricing/PricingEngineService";

/**
 * Sprint 4A - QuotationPricingService（报价定价服务，CTO Phase 2）
 * 只负责把 Quotation 上下文转换为 PricingContext，然后调用现有 PricingEngineService.resolvePrice()，
 * 不重新编写报价价格算法（ADR-0015：Quotation must consume Pricing Engine）。
 *
 * 链路（CTO 红线）：
 *   QuotationLine → PricingEngine.resolvePrice() → QuotationPriceSnapshot → QuotationLine.priceSnapshotId
 *
 * 规则：
 *  - 前端不能直接决定正式 unitPrice；unitPrice 只能来自 Pricing Engine 返回结果
 *  - 手工改价必须：有专门权限（quotation:override-price，后续 ADR 扩展）+ 生成新的价格快照 + 写 AuditLog + 进入审批
 */

export interface QuotationPricingLineInput {
  lineId: string; // QuotationLine.id（用于回写 priceSnapshotId）
  itemId: string;
  quantity: number | Prisma.Decimal;
  uom?: string;
}

export interface QuotationPricingInput {
  quotationId: string;
  customerId: string; // Customer.id（转 PricingContext.partnerId = customer.partnerId）
  currency: string;
  pricingDate: Date;
  taxProfileId?: string;
  taxIncluded?: boolean;
  lines: QuotationPricingLineInput[];
}

export interface QuotationPricingLineResult {
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

export class QuotationPricingService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /** 逐行定价：Quotation 上下文 → PricingContext → resolvePrice() → 回写快照 quotationId/lineId */
  async priceLines(input: QuotationPricingInput): Promise<QuotationPricingLineResult[]> {
    // 客户 → Partner（BusinessPartner 唯一主体；PricingEngine 按 partnerId 命中 PartnerPrice）
    const customer = await this.db.customer.findFirst({ where: { id: input.customerId, deletedAt: null } });
    const partnerId = customer?.partnerId ?? undefined;

    const results: QuotationPricingLineResult[] = [];
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

      // 回写快照：quotationId / quotationLineId（resolvePrice 内以 ctx.projectId ?? "PENDING" 占位）
      await this.db.quotationPriceSnapshot.update({
        where: { id: result.snapshotId },
        data: { quotationId: input.quotationId, quotationLineId: line.lineId },
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

export const quotationPricingService = new QuotationPricingService();
