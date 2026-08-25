import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failValidation } from "@/lib/api/response";
import { requestLog } from "@/lib/api/logger";
import { BUSINESS_TIMEZONE_OFFSET_MS } from "@/lib/gl/period";
import { reportPeriodKey, TARGET_DIMENSION_TYPES, achievementRate } from "@/lib/reports/constants";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports/operations?period=day|month|year —— 经营数据固定看板（只读聚合，feat(crm) MVP）
 *
 * 不做 BI/OLAP/DW：直接基于现有业务模型按区间 count / sum（头级金额，Decimal 字符串返回，禁止 toNumber）。
 * 业务日边界 = Asia/Shanghai（复用 lib/gl/period 业务日工具，ADR-0044 时区策略）。
 *
 * 指标口径（固定看板 MVP，页面展示同时给出明细构成，避免口径黑盒）：
 * - salesOrders：期间内（createdAt）订单数/金额，status != CANCELLED（取消单不计经营）；byStatus 给出全部状态构成
 * - quotations：期间内（createdAt）报价数/金额，status != CANCELLED
 * - customers.total：在册客户总数（type = CUSTOMER | BOTH）；newInPeriod：期间内新增客户
 * - opportunities.total / funnel：在册商机总数 + 按 stage 漏斗（当前管线快照）；newInPeriod：期间内新增商机
 * - visits：期间内拜访（CHECK_IN）/ 跟进（FOLLOW_UP）次数（CustomerActivity）
 *
 * 追加（feat(crm) expense-analytics，Migration 0051）：
 * - targets：目标值/达成率 —— ReportTarget（period 键 + dimensionValue=ALL）静态目标 × 本期实际，rate = actual/target×100%（1 位小数）
 * - customerTiers：客户分层（事实计算，非 AI）—— 有成交（非草稿/非取消 SO）> 有报价未成交（非取消 Quotation）>
 *   有商机无报价（ProjectOpportunity）> 普通客户（其余在册客户）；点态快照（跨全史），不计期间
 * - regions：固定区域维度（BusinessPartner.region）—— 区域客户数 + 期间内订单数/金额（未设置区域归 "未设置"）
 *
 * RBAC：reports:view（shared PERMISSION_MODULES + prisma/seed.ts SEED_ACTION_MODULES 同步注册，ADR-0028）。
 */
const PERIODS = ["day", "month", "year"] as const;
type Period = (typeof PERIODS)[number];

/** 期间边界（UTC 时刻，排他 end）：Asia/Shanghai 业务日解析（ADR-0044 时区策略，禁止拼 T23:59:59.999Z） */
function periodRange(period: Period, now: Date = new Date()): { start: Date; end: Date } {
  const shifted = new Date(now.getTime() + BUSINESS_TIMEZONE_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  const dayStartUtc = Date.UTC(y, m, d) - BUSINESS_TIMEZONE_OFFSET_MS;
  if (period === "day") {
    return { start: new Date(dayStartUtc), end: new Date(dayStartUtc + 24 * 60 * 60 * 1000) };
  }
  const monthStartUtc = Date.UTC(y, m, 1) - BUSINESS_TIMEZONE_OFFSET_MS;
  if (period === "month") {
    return { start: new Date(monthStartUtc), end: new Date(Date.UTC(y, m + 1, 1) - BUSINESS_TIMEZONE_OFFSET_MS) };
  }
  const yearStartUtc = Date.UTC(y, 0, 1) - BUSINESS_TIMEZONE_OFFSET_MS;
  return { start: new Date(yearStartUtc), end: new Date(Date.UTC(y + 1, 0, 1) - BUSINESS_TIMEZONE_OFFSET_MS) };
}

export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "reports:view");
  if (denied) return denied;
  requestLog(request, user?.id, "reports.operations");

  const { searchParams } = new URL(request.url);
  const rawPeriod = (searchParams.get("period")?.trim() || "month") as Period;
  if (!PERIODS.includes(rawPeriod)) {
    return failValidation({ period: "period 必须为 day | month | year" });
  }
  const { start, end } = periodRange(rawPeriod);
  const range: Prisma.DateTimeFilter = { gte: start, lt: end };
  const pKey = reportPeriodKey(rawPeriod);

  const orderWhere: Prisma.SalesOrderWhereInput = { deletedAt: null, createdAt: range };
  // CTO 口径（MUST-FIX）：经营金额/数量不含 DRAFT（草稿非成交）；groupBy 状态构成仍保留全状态透明展示
  const orderActiveWhere: Prisma.SalesOrderWhereInput = { ...orderWhere, status: { notIn: ["DRAFT", "CANCELLED"] } };
  const quotationWhere: Prisma.QuotationWhereInput = { deletedAt: null, createdAt: range, status: { not: "CANCELLED" } };
  const customerWhere: Prisma.BusinessPartnerWhereInput = { deletedAt: null, type: { in: ["CUSTOMER", "BOTH"] } };
  const opportunityWhere: Prisma.ProjectOpportunityWhereInput = { deletedAt: null };
  // 跟进/拜访口径（CTO MUST-FIX）：客户级真实 = CustomerActivity（#234，Migration 0050）；
  // 跟进=FOLLOW_UP、拜访=CHECK_IN，按 createdAt 时间范围；不再用 ProjectVisit 冒充（禁双加）
  const activityRange: Prisma.CustomerActivityWhereInput = { deletedAt: null, createdAt: range };

  const [
    orderCount,
    orderAmount,
    orderByStatus,
    quotationCount,
    quotationAmount,
    customerTotal,
    customerNew,
    opportunityTotal,
    opportunityNew,
    opportunityFunnel,
    visitCount,
    followUpCount,
  ] = await Promise.all([
    prisma.salesOrder.count({ where: orderActiveWhere }),
    prisma.salesOrder.aggregate({ where: orderActiveWhere, _sum: { totalAmount: true } }),
    prisma.salesOrder.groupBy({ by: ["status"], where: orderWhere, _count: { _all: true } }),
    prisma.quotation.count({ where: quotationWhere }),
    prisma.quotation.aggregate({ where: quotationWhere, _sum: { totalAmount: true } }),
    prisma.businessPartner.count({ where: customerWhere }),
    prisma.businessPartner.count({ where: { ...customerWhere, createdAt: range } }),
    prisma.projectOpportunity.count({ where: opportunityWhere }),
    prisma.projectOpportunity.count({ where: { ...opportunityWhere, createdAt: range } }),
    prisma.projectOpportunity.groupBy({ by: ["stage"], where: opportunityWhere, _count: { _all: true } }),
    prisma.customerActivity.count({ where: { ...activityRange, activityType: "CHECK_IN" } }),
    prisma.customerActivity.count({ where: { ...activityRange, activityType: "FOLLOW_UP" } }),
  ]);

  // ===== 目标值/达成率（ReportTarget 静态目标 × 本期实际；维度值 ALL 全局目标） =====
  const targetsRaw = await prisma.reportTarget.findMany({
    where: { deletedAt: null, isActive: true, period: pKey, dimensionValue: "ALL" },
    orderBy: { dimensionType: "asc" },
  });
  const actuals: Record<string, string | number> = {
    SALES_AMOUNT: orderAmount._sum.totalAmount?.toString() ?? "0",
    NEW_CUSTOMERS: customerNew,
    NEW_OPPORTUNITIES: opportunityNew,
    QUOTATIONS: quotationCount,
    VISITS: visitCount,
    FOLLOW_UPS: followUpCount,
  };
  const targets = targetsRaw
    .filter((t) => (TARGET_DIMENSION_TYPES as readonly string[]).includes(t.dimensionType))
    .map((t) => ({
      id: t.id,
      dimensionType: t.dimensionType,
      dimensionValue: t.dimensionValue,
      targetAmount: t.targetAmount.toString(),
      actual: String(actuals[t.dimensionType] ?? 0),
      rate: achievementRate(t.targetAmount.toString(), actuals[t.dimensionType] ?? 0),
    }));

  // ===== 客户分层（事实计算，非 AI）：有成交 > 有报价未成交 > 有商机无报价 > 普通客户 =====
  const [dealCustomers, quotedCustomers, oppCustomers] = await Promise.all([
    prisma.salesOrder.findMany({
      where: { deletedAt: null, status: { notIn: ["DRAFT", "CANCELLED"] } },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
    prisma.quotation.findMany({
      where: { deletedAt: null, status: { not: "CANCELLED" } },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
    prisma.projectOpportunity.findMany({
      where: { deletedAt: null },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
  ]);
  const dealSet = new Set(dealCustomers.map((r) => r.customerId));
  const quoteSet = new Set(quotedCustomers.map((r) => r.customerId));
  const oppSet = new Set(oppCustomers.map((r) => r.customerId));
  const quotedOnly = new Set([...quoteSet].filter((id) => !dealSet.has(id)));
  const opportunityOnly = new Set([...oppSet].filter((id) => !dealSet.has(id) && !quoteSet.has(id)));
  const customerTiers = {
    total: customerTotal,
    deal: dealSet.size,
    quoted: quotedOnly.size,
    opportunity: opportunityOnly.size,
    normal: Math.max(customerTotal - dealSet.size - quotedOnly.size - opportunityOnly.size, 0),
  };

  // ===== 固定区域维度（BusinessPartner.region）：区域客户数 + 期间订单数/金额 =====
  const [regionCustomerGroups, regionOrders] = await Promise.all([
    prisma.businessPartner.groupBy({ by: ["region"], where: customerWhere, _count: { _all: true } }),
    prisma.salesOrder.findMany({
      where: orderActiveWhere,
      select: { customerId: true, totalAmount: true },
    }),
  ]);
  const regionCustomerIds = Array.from(new Set(regionOrders.map((o) => o.customerId)));
  const regionCustomers = regionCustomerIds.length
    ? await prisma.businessPartner.findMany({
        where: { id: { in: regionCustomerIds } },
        select: { id: true, region: true },
      })
    : [];
  const regionByCustomer = new Map(regionCustomers.map((c) => [c.id, c.region]));
  const regionAgg = new Map<
    string,
    { customerCount: number; salesOrderCount: number; salesAmount: Prisma.Decimal }
  >();
  for (const o of regionOrders) {
    const region = regionByCustomer.get(o.customerId) ?? "未设置";
    const cur = regionAgg.get(region) ?? {
      customerCount: 0,
      salesOrderCount: 0,
      salesAmount: new Prisma.Decimal(0),
    };
    cur.salesOrderCount += 1;
    cur.salesAmount = cur.salesAmount.plus(o.totalAmount ?? 0);
    regionAgg.set(region, cur);
  }
  for (const g of regionCustomerGroups) {
    const region = g.region ?? "未设置";
    const cur = regionAgg.get(region) ?? {
      customerCount: 0,
      salesOrderCount: 0,
      salesAmount: new Prisma.Decimal(0),
    };
    cur.customerCount += g._count._all;
    regionAgg.set(region, cur);
  }
  const regions = [...regionAgg.entries()]
    .map(([region, v]) => ({
      region,
      customerCount: v.customerCount,
      salesOrderCount: v.salesOrderCount,
      salesAmount: v.salesAmount.toString(),
    }))
    .sort((a, b) => b.salesOrderCount - a.salesOrderCount);

  // ===== 固定品牌维度（Item.brand 真实事实源）：SalesOrderLine → Item.brand → 行数/金额（未设置归「未设置」）=====
  const brandLines = await prisma.salesOrderLine.findMany({
    where: {
      deletedAt: null,
      salesOrder: { deletedAt: null, status: { notIn: ["DRAFT", "CANCELLED"] }, createdAt: range },
    },
    select: { itemId: true, totalAmount: true },
  });
  const brandItemIds = [...new Set(brandLines.map((l) => l.itemId).filter((x): x is string => x !== null))];
  const brandItems = brandItemIds.length
    ? await prisma.item.findMany({ where: { id: { in: brandItemIds } }, select: { id: true, brand: true } })
    : [];
  const brandByItem = new Map(brandItems.map((i) => [i.id, i.brand]));
  const brandAgg = new Map<string, { lineCount: number; amount: Prisma.Decimal }>();
  for (const l of brandLines) {
    if (!l.itemId) continue;
    const brand = brandByItem.get(l.itemId) ?? "未设置";
    const cur = brandAgg.get(brand) ?? { lineCount: 0, amount: new Prisma.Decimal(0) };
    cur.lineCount += 1;
    cur.amount = cur.amount.plus(l.totalAmount ?? 0);
    brandAgg.set(brand, cur);
  }
  const brands = [...brandAgg.entries()]
    .map(([brand, v]) => ({ brand, lineCount: v.lineCount, amount: v.amount.toString() }))
    .sort((a, b) => b.lineCount - a.lineCount);

  return ok({
    period: rawPeriod,
    range: { from: start.toISOString(), to: end.toISOString() },
    salesOrders: {
      count: orderCount,
      amount: orderAmount._sum.totalAmount?.toString() ?? null,
      byStatus: Object.fromEntries(orderByStatus.map((g) => [g.status, g._count._all])),
    },
    quotations: {
      count: quotationCount,
      amount: quotationAmount._sum.totalAmount?.toString() ?? null,
    },
    customers: { total: customerTotal, newInPeriod: customerNew },
    opportunities: {
      total: opportunityTotal,
      newInPeriod: opportunityNew,
      funnel: Object.fromEntries(opportunityFunnel.map((g) => [g.stage, g._count._all])),
    },
    visits: { visits: visitCount, followUps: followUpCount },
    targets,
    customerTiers,
    regions,
    brands,
    // channel：当前无明确 SSOT 事实源 → 前端显示「暂无渠道事实数据」（CTO ⑦；禁造字段）
    channelAvailable: false,
  });
}
