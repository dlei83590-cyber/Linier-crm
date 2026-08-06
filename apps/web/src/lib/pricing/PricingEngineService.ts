import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Sprint 3C-4 - Pricing Engine Service（价格引擎，CTO #2345/#2360）
 * 统一入口 resolvePrice()，内部编排：
 *   Load Context → Match Policy → Match Rules → PartnerPrice/PriceList 取价
 *   → Promotion → Currency Conversion → Tax → Snapshot → Audit
 * 所有金额一律 Decimal（禁止 Float），有效期统一 effectiveFrom/effectiveTo。
 * Quotation（Sprint 4）/ Project / Sales 只调用 resolvePrice()，禁止业务模块自行计算。
 */

export interface PricingContext {
  partnerId?: string; // 客户/供应商（Partner 级）
  partnerRole?: "CUSTOMER" | "SUPPLIER" | "BOTH" | "LOGISTICS" | "OUTSOURCING";
  itemId: string;
  quantity: number;
  pricingDate: Date;
  currency: string; // 报价币种
  priceListId?: string; // 指定价目表（可选）
  policyId?: string; // 指定策略（可选）
  region?: string;
  projectId?: string;
  salespersonId?: string;
  uom?: string;
  taxProfileId?: string; // 指定税率档案（可选）
  taxIncluded?: boolean; // 报价是否含税
}

export interface PriceResult {
  unitPrice: Prisma.Decimal; // 基础价（未税）
  discountRate: Prisma.Decimal; // 折扣率 %
  taxRate: Prisma.Decimal; // 税率 %
  currency: string;
  source: "PRICE_LIST" | "PARTNER_PRICE" | "PROMOTION";
  priceListId?: string | null;
  priceListVersionId?: string | null;
  policyId?: string | null;
  policyType?: string | null;
  promotionRuleId?: string | null;
  promotionDiscount: Prisma.Decimal; // 促销命中折扣金额
  exchangeRate: Prisma.Decimal; // 汇率（同币种为 1）
  baseUnitPrice: Prisma.Decimal; // 转换后基础价
  finalUnitPrice: Prisma.Decimal; // 最终单价（含促销/币种，未税）
  finalAmount: Prisma.Decimal; // 最终金额
  snapshotId?: string; // QuotationPriceSnapshot id（已固化）
}

/** 条件求值：PriceRule.conditions 为 JSON 对象（如 { minQty: 100, customerLevel: "VIP", region: "East China" }） */
function matchRuleConditions(conditions: Prisma.JsonValue | null, ctx: PricingContext): boolean {
  if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)) return false;
  const cond = conditions as Record<string, unknown>;

  // 数量阶梯：minQty ≤ quantity
  if (typeof cond.minQty === "number" && ctx.quantity < cond.minQty) return false;
  // 客户等级：仅在客户场景（CUSTOMER/BOTH）生效
  if (cond.customerLevel !== undefined) {
    if (ctx.partnerRole !== "CUSTOMER" && ctx.partnerRole !== "BOTH") return false;
  }
  // 区域
  if (typeof cond.region === "string" && cond.region !== ctx.region) return false;
  return true;
}

export class PricingEngineService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /** 统一入口（CTO #2249/#2345：resolvePrice 唯一入口） */
  async resolvePrice(ctx: PricingContext): Promise<PriceResult> {
    const currency = ctx.currency || "CNY";
    const now = ctx.pricingDate ?? new Date();

    // ① Load Context：物料必须存在
    const item = await this.db.item.findFirst({ where: { id: ctx.itemId, deletedAt: null } });
    if (!item) throw new Error("ITEM_NOT_FOUND");

    // ② Match Policy：指定 policyId 优先，否则按 active + priority 升序取第一个
    let policy = null;
    if (ctx.policyId) {
      policy = await this.db.pricePolicy.findFirst({ where: { id: ctx.policyId, deletedAt: null, isActive: true } });
    } else {
      policy = await this.db.pricePolicy.findFirst({
        where: { deletedAt: null, isActive: true, approvalStatus: "APPROVED" },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      });
    }

    // ③ Match Rules：命中第一条（按 priority 升序），应用折扣
    let discountRate = new Prisma.Decimal(0);
    if (policy) {
      const rules = await this.db.priceRule.findMany({
        where: { policyId: policy.id, deletedAt: null, isActive: true, approvalStatus: "APPROVED" },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      });
      for (const rule of rules) {
        if (matchRuleConditions(rule.conditions, ctx)) {
          if (rule.discountRate) discountRate = new Prisma.Decimal(rule.discountRate);
          if (policy.stopOnMatch) break;
        }
      }
    }

    // ④ 取价：PartnerPrice 优先（partnerId 命中，按 priority 升序），否则 PriceList 价目表明细
    let unitPrice: Prisma.Decimal | null = null;
    let source: PriceResult["source"] = "PRICE_LIST";
    let priceListId: string | null = null;
    let priceListVersionId: string | null = null;

    if (ctx.partnerId) {
      const partnerPrice = await this.db.partnerPrice.findFirst({
        where: {
          partnerId: ctx.partnerId,
          itemId: ctx.itemId,
          deletedAt: null,
          isActive: true,
          approvalStatus: "APPROVED",
          AND: [
            { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
            { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
          ],
        },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      });
      if (partnerPrice) {
        unitPrice = new Prisma.Decimal(partnerPrice.unitPrice);
        source = "PARTNER_PRICE";
      }
    }

    if (!unitPrice) {
      const priceListWhere = ctx.priceListId ? { id: ctx.priceListId } : {};
      const priceList = await this.db.priceList.findFirst({
        where: { ...priceListWhere, deletedAt: null, isActive: true, status: "PUBLISHED" },
        include: {
          versions: { where: { status: "PUBLISHED", isActive: true }, orderBy: [{ versionNo: "desc" }], take: 1 },
        },
      });
      if (priceList) {
        const line = await this.db.priceListItem.findFirst({
          where: {
            priceListId: priceList.id,
            itemId: ctx.itemId,
            deletedAt: null,
            isActive: true,
            approvalStatus: "APPROVED",
            AND: [
              { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
              { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
            ],
          },
          orderBy: [{ minOrderQty: "asc" }],
        });
        if (line) {
          unitPrice = new Prisma.Decimal(line.unitPriceExclTax);
          priceListId = priceList.id;
          priceListVersionId = priceList.versions[0]?.id ?? null;
        }
      }
    }

    if (!unitPrice) throw new Error("PRICE_NOT_FOUND");

    // ⑤ Promotion：命中 ACTIVE 且有效期内的促销（Demo 保持简单：PERCENT）
    let promotionRuleId: string | null = null;
    let promotionDiscount = new Prisma.Decimal(0);
    const promotion = await this.db.promotionRule.findFirst({
      where: {
        deletedAt: null,
        isActive: true,
        status: "ACTIVE",
        approvalStatus: "APPROVED",
        AND: [
          { OR: [{ startAt: null }, { startAt: { lte: now } }] },
          { OR: [{ endAt: null }, { endAt: { gte: now } }] },
        ],
      },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });
    if (promotion) {
      promotionRuleId = promotion.id;
      if (promotion.promotionType === "PERCENT") {
        promotionDiscount = unitPrice.mul(new Prisma.Decimal(promotion.discountValue)).div(100);
      } else {
        promotionDiscount = new Prisma.Decimal(promotion.discountValue);
      }
    }

    // ⑥ Currency Conversion：base=CNY（价目表默认），报价币种不同则查汇率
    let exchangeRate = new Prisma.Decimal(1);
    if (currency !== "CNY") {
      const rate = await this.db.exchangeRate.findFirst({
        where: {
          baseCurrency: "CNY",
          quoteCurrency: currency,
          effectiveDate: { lte: now },
          isActive: true,
        },
        orderBy: { effectiveDate: "desc" },
      });
      if (rate) exchangeRate = new Prisma.Decimal(rate.rate);
    }

    // ⑦ Tax：指定 TaxProfile 或环境默认（CN 13%），税率快照
    let taxRate = new Prisma.Decimal(0);
    if (ctx.taxProfileId) {
      const profile = await this.db.taxProfile.findFirst({ where: { id: ctx.taxProfileId, deletedAt: null, isActive: true } });
      if (profile?.rate) taxRate = new Prisma.Decimal(profile.rate);
    } else {
      const profile = await this.db.taxProfile.findFirst({
        where: { country: "CN", deletedAt: null, isActive: true, approvalStatus: "APPROVED" },
        orderBy: { createdAt: "asc" },
      });
      if (profile?.rate) taxRate = new Prisma.Decimal(profile.rate);
    }

    // 金额计算（全程 Decimal）
    const baseUnitPrice = unitPrice.mul(exchangeRate);
    const afterDiscount = baseUnitPrice.mul(new Prisma.Decimal(1).sub(discountRate.div(100)));
    const afterPromotion = afterDiscount.sub(promotionDiscount).lt(0) ? new Prisma.Decimal(0) : afterDiscount.sub(promotionDiscount);
    const finalUnitPrice = afterPromotion;
    const finalAmount = finalUnitPrice.mul(new Prisma.Decimal(ctx.quantity));

    // ⑧ Snapshot：固化 QuotationPriceSnapshot（完整定价链）
    const snapshot = await this.db.quotationPriceSnapshot.create({
      data: {
        quotationId: ctx.projectId ?? "PENDING",
        itemId: ctx.itemId,
        priceListId,
        pricePolicyId: policy?.id ?? null,
        promotionRuleId,
        promotionDiscount,
        currency,
        exchangeRate,
        taxProfileId: null,
        taxRate,
        baseUnitPrice,
        discountRate,
        finalUnitPrice,
        finalAmount,
        pricingTime: now,
        pricingEngineVersion: "v1",
        approvalStatus: "APPROVED",
      },
    });

    // ⑨ Audit：价格变更审计（PriceAudit）
    await this.db.priceAudit.create({
      data: {
        entityType: source === "PARTNER_PRICE" ? "PartnerPrice" : "PriceList",
        entityId: ctx.itemId,
        oldPrice: null,
        newPrice: finalUnitPrice,
        reason: "resolvePrice",
        effectiveTime: now,
      },
    });

    return {
      unitPrice,
      discountRate,
      taxRate,
      currency,
      source,
      priceListId,
      priceListVersionId,
      policyId: policy?.id ?? null,
      policyType: policy?.policyType ?? null,
      promotionRuleId,
      promotionDiscount,
      exchangeRate,
      baseUnitPrice,
      finalUnitPrice,
      finalAmount,
      snapshotId: snapshot.id,
    };
  }
}

export const pricingEngineService = new PricingEngineService();
