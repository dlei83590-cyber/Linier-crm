import { NextRequest } from "next/server";
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

/**
 * GET /api/reports/performance?period=week|month —— 绩效数据固定页 MVP（只读聚合，客观事实）
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

  const { from, to } = performancePeriodRange(period);

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
    period,
    from: from.toISOString(),
    to: to.toISOString(),
    dataSources: PERFORMANCE_DATA_SOURCES,
    rows,
  });
}
