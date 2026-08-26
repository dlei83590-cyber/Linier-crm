import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { requestLog } from "@/lib/api/logger";
import { ok, failValidation } from "@/lib/api/response";
import { BUSINESS_TIMEZONE_OFFSET_MS } from "@/lib/gl/period";

export const dynamic = "force-dynamic";

export type PerformancePeriod = "week" | "month";

export interface PerformancePeriodRange {
  from: Date;
  to: Date;
}

/**
 * 绩效周期区间（Asia/Shanghai 业务日，与经营数据一致——复用 lib/gl/period 业务日工具，ADR-0044）：
 * - week：本周一 00:00 CST 起（周一为一周起点），跨度 7 天（排他 end）
 * - month：本月 1 日 00:00 CST 起，至下月 1 日（排他 end）
 * 查询统一 gte from / lt to；不做任何主观评分/权重/奖金算法。
 */
export function performancePeriodRange(
  period: PerformancePeriod,
  now: Date = new Date(),
): PerformancePeriodRange {
  const shifted = new Date(now.getTime() + BUSINESS_TIMEZONE_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  const dayStartUtc = Date.UTC(y, m, d) - BUSINESS_TIMEZONE_OFFSET_MS;
  if (period === "week") {
    const offsetFromMonday = (shifted.getUTCDay() + 6) % 7;
    const weekStartUtc = dayStartUtc - offsetFromMonday * 24 * 60 * 60 * 1000;
    return { from: new Date(weekStartUtc), to: new Date(weekStartUtc + 7 * 24 * 60 * 60 * 1000) };
  }
  const monthStartUtc = Date.UTC(y, m, 1) - BUSINESS_TIMEZONE_OFFSET_MS;
  return { from: new Date(monthStartUtc), to: new Date(Date.UTC(y, m + 1, 1) - BUSINESS_TIMEZONE_OFFSET_MS) };
}

/** 数据源可用性（schema 事实，非运行时猜测）：false = 模型不存在 → 前端显示「暂无事实数据」 */
export const PERFORMANCE_DATA_SOURCES = {
  newCustomers: true, // BusinessPartner.createdById
  followUps: true, // CustomerActivity.FOLLOW_UP（#234，Migration 0050；createdById + 时间范围）
  visits: true, // CustomerActivity.CHECK_IN（#234；createdById + 时间范围；不再用 ProjectVisit 冒充）
  opportunities: true, // ProjectOpportunity.ownerId
  quotations: true, // Quotation.createdById
  salesOrders: true, // SalesOrder.createdById（成交口径：排除 DRAFT/CANCELLED）
  salesAmount: true, // SalesOrder.totalAmount（成交口径同 salesOrders）
} as const;

export type PerformanceView = "person" | "region";

/** 区域未设置归组标签（BusinessPartner.region 为空 → 该组；SSOT：region 字段即事实，禁止用 Department 冒充） */
export const UNASSIGNED_REGION = "未设置";

export interface RegionPerformanceRow {
  region: string;
  newCustomerCount: number;
  followUpCount: number;
  visitCount: number;
  opportunityCount: number;
  quotationCount: number;
  salesOrderCount: number;
  salesAmount: string;
}

/**
 * 区域绩效聚合（view=region）：所有维度经实体 → BusinessPartner.region 归属（真实客户区域，SSOT 红线）：
 * - 新增客户：周期内新建 BP（createdById 非空，与个人视图同一事实集）按 BP 自身 region 分组
 * - 跟进/拜访：CustomerActivity.FOLLOW_UP / CHECK_IN → businessPartnerId → BP.region（按客户归属，不依赖操作人）
 * - 商机/报价/成交订单：ProjectOpportunity / Quotation / SalesOrder → customerId → BP.region
 * - 成交金额：成交口径（status ∉ DRAFT/CANCELLED）totalAmount 按 region 求和（Decimal 计算，禁止 toNumber）
 * BusinessPartner.region 为空 → "未设置" 分组；不引入主观评分/权重/奖金算法（HOLD）。
 */
async function buildRegionRows(from: Date, to: Date): Promise<RegionPerformanceRow[]> {
  const range = { gte: from, lt: to };
  const [newBps, followUps, visits, opps, quotes, sos] = await Promise.all([
    prisma.businessPartner.findMany({
      where: { deletedAt: null, createdById: { not: null }, createdAt: range },
      select: { region: true },
    }),
    prisma.customerActivity.findMany({
      where: { deletedAt: null, createdAt: range, activityType: "FOLLOW_UP" },
      select: { businessPartnerId: true },
    }),
    prisma.customerActivity.findMany({
      where: { deletedAt: null, createdAt: range, activityType: "CHECK_IN" },
      select: { businessPartnerId: true },
    }),
    prisma.projectOpportunity.findMany({
      where: { deletedAt: null, createdAt: range },
      select: { customerId: true },
    }),
    prisma.quotation.findMany({
      where: { deletedAt: null, quoteDate: range },
      select: { customerId: true },
    }),
    prisma.salesOrder.findMany({
      where: { deletedAt: null, orderDate: range, status: { notIn: ["DRAFT", "CANCELLED"] } },
      select: { customerId: true, totalAmount: true },
    }),
  ]);

  const bpIds = new Set<string>();
  for (const a of followUps) bpIds.add(a.businessPartnerId);
  for (const a of visits) bpIds.add(a.businessPartnerId);
  for (const o of opps) bpIds.add(o.customerId);
  for (const q of quotes) bpIds.add(q.customerId);
  for (const s of sos) bpIds.add(s.customerId);
  const bpRegions = bpIds.size
    ? await prisma.businessPartner.findMany({
        where: { id: { in: [...bpIds] } },
        select: { id: true, region: true },
      })
    : [];
  const regionByBp = new Map(bpRegions.map((b) => [b.id, b.region ?? null]));
  const regionOf = (bpId: string | null): string => {
    if (!bpId) return UNASSIGNED_REGION;
    return regionByBp.get(bpId) ?? UNASSIGNED_REGION;
  };

  interface RegionAcc {
    newCustomerCount: number;
    followUpCount: number;
    visitCount: number;
    opportunityCount: number;
    quotationCount: number;
    salesOrderCount: number;
    salesAmount: Prisma.Decimal;
  }
  const acc = new Map<string, RegionAcc>();
  const bump = (region: string): RegionAcc => {
    let cur = acc.get(region);
    if (!cur) {
      cur = {
        newCustomerCount: 0,
        followUpCount: 0,
        visitCount: 0,
        opportunityCount: 0,
        quotationCount: 0,
        salesOrderCount: 0,
        salesAmount: new Prisma.Decimal(0),
      };
      acc.set(region, cur);
    }
    return cur;
  };

  for (const b of newBps) bump(b.region ?? UNASSIGNED_REGION).newCustomerCount += 1;
  for (const a of followUps) bump(regionOf(a.businessPartnerId)).followUpCount += 1;
  for (const a of visits) bump(regionOf(a.businessPartnerId)).visitCount += 1;
  for (const o of opps) bump(regionOf(o.customerId)).opportunityCount += 1;
  for (const q of quotes) bump(regionOf(q.customerId)).quotationCount += 1;
  for (const s of sos) {
    const cur = bump(regionOf(s.customerId));
    cur.salesOrderCount += 1;
    cur.salesAmount = cur.salesAmount.plus(s.totalAmount ?? 0);
  }

  return [...acc.entries()]
    .map(([region, v]) => ({
      region,
      newCustomerCount: v.newCustomerCount,
      followUpCount: v.followUpCount,
      visitCount: v.visitCount,
      opportunityCount: v.opportunityCount,
      quotationCount: v.quotationCount,
      salesOrderCount: v.salesOrderCount,
      salesAmount: v.salesAmount.toString(),
    }))
    .sort((a, b) => b.salesOrderCount - a.salesOrderCount || a.region.localeCompare(b.region, "zh-Hans-CN"));
}

/**
 * GET /api/reports/performance?period=week|month&view=person|region —— 绩效数据固定页（只读聚合，客观事实）
 * view=person（默认）：按 User 分组统计客观事实；view=region：区域周报——按真实客户区域
 * BusinessPartner.region 分组（实体 → customerId/businessPartnerId → BP.region；未设置 → "未设置"）。
 *
 * 按 User 分组统计周期内（本周/本月）客观业务事实，金额统一 Decimal 字符串返回（禁止 toNumber()）：
 * - 新增客户数：BusinessPartner.createdById（deletedAt = null）
 * - 跟进次数：数据源缺失（schema 无 CRM 活动模型）→ 恒 null，前端显示「暂无事实数据」
 * - 拜访次数：ProjectVisit.visitorId（visitedAt 在周期内）
 * - 商机数：ProjectOpportunity.ownerId（createdAt 在周期内）
 * - 报价数：Quotation.createdById（quoteDate 在周期内）
 * - 成交订单数 / 成交金额：SalesOrder.createdById（orderDate 在周期内，status ∉ {DRAFT, CANCELLED}）
 *
 * 红线：不引入主观评分/权重/奖金算法/KPI Engine/排名平台/复杂目标配置（HOLD）。
 * 权限：reports:view（与经营数据固定看板共享；PERMISSION_MODULES + seed 同步注册，ADR-0028）。
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "reports:view");
  if (denied) return denied;
  requestLog(request, user?.id, "reports.performance");

  const { searchParams } = new URL(request.url);
  const periodRaw = searchParams.get("period") ?? "week";
  const period: PerformancePeriod | null =
    periodRaw === "week" || periodRaw === "month" ? periodRaw : null;
  if (!period) {
    return failValidation({ period: "period 必须为 week 或 month" });
  }
  const viewRaw = searchParams.get("view") ?? "person";
  const view: PerformanceView | null =
    viewRaw === "person" || viewRaw === "region" ? viewRaw : null;
  if (!view) {
    return failValidation({ view: "view 必须为 person 或 region" });
  }

  const { from, to } = performancePeriodRange(period);

  // 区域周报（view=region）：按真实客户区域 BusinessPartner.region 聚合（未设置 → "未设置"）
  if (view === "region") {
    const regions = await buildRegionRows(from, to);
    return ok({
      view,
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      dataSources: PERFORMANCE_DATA_SOURCES,
      regions,
    });
  }

  const [users, bpGroups, followUpGroups, visitGroups, oppGroups, quoteGroups, soGroups] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        email: true,
        name: true,
        department: { select: { name: true } },
      },
    }),
    prisma.businessPartner.groupBy({
      by: ["createdById"],
      where: { deletedAt: null, createdById: { not: null }, createdAt: { gte: from, lt: to } },
      _count: { _all: true },
    }),
    // 跟进 = CustomerActivity.FOLLOW_UP（#234）；拜访 = CustomerActivity.CHECK_IN（不再用 ProjectVisit 冒充）
    prisma.customerActivity.groupBy({
      by: ["createdById"],
      where: { deletedAt: null, createdById: { not: null }, createdAt: { gte: from, lt: to }, activityType: "FOLLOW_UP" },
      _count: { _all: true },
    }),
    prisma.customerActivity.groupBy({
      by: ["createdById"],
      where: { deletedAt: null, createdById: { not: null }, createdAt: { gte: from, lt: to }, activityType: "CHECK_IN" },
      _count: { _all: true },
    }),
    prisma.projectOpportunity.groupBy({
      by: ["ownerId"],
      where: { deletedAt: null, ownerId: { not: null }, createdAt: { gte: from, lt: to } },
      _count: { _all: true },
    }),
    prisma.quotation.groupBy({
      by: ["createdById"],
      where: { deletedAt: null, createdById: { not: null }, quoteDate: { gte: from, lt: to } },
      _count: { _all: true },
    }),
    prisma.salesOrder.groupBy({
      by: ["createdById"],
      where: {
        deletedAt: null,
        createdById: { not: null },
        orderDate: { gte: from, lt: to },
        status: { notIn: ["DRAFT", "CANCELLED"] },
      },
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
  ]);

  const bpCounts = new Map(bpGroups.map((g) => [g.createdById as string, g._count._all]));
  const followUpCounts = new Map(followUpGroups.map((g) => [g.createdById as string, g._count._all]));
  const visitCounts = new Map(visitGroups.map((g) => [g.createdById as string, g._count._all]));
  const oppCounts = new Map(oppGroups.map((g) => [g.ownerId as string, g._count._all]));
  const quoteCounts = new Map(quoteGroups.map((g) => [g.createdById as string, g._count._all]));
  const soCounts = new Map(soGroups.map((g) => [g.createdById as string, g._count._all]));
  const soAmounts = new Map(
    soGroups.map((g) => [g.createdById as string, g._sum.totalAmount ?? null]),
  );

  const rows = users.map((u) => ({
    userId: u.id,
    userName: u.name ?? u.email,
    userEmail: u.email,
    departmentName: u.department?.name ?? null,
    newCustomerCount: bpCounts.get(u.id) ?? 0,
    followUpCount: followUpCounts.get(u.id) ?? 0,
    visitCount: visitCounts.get(u.id) ?? 0,
    opportunityCount: oppCounts.get(u.id) ?? 0,
    quotationCount: quoteCounts.get(u.id) ?? 0,
    salesOrderCount: soCounts.get(u.id) ?? 0,
    salesAmount: (soAmounts.get(u.id) ?? null)?.toString() ?? "0",
  }));

  return ok({
    view,
    period,
    from: from.toISOString(),
    to: to.toISOString(),
    dataSources: PERFORMANCE_DATA_SOURCES,
    rows,
  });
}
