import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failValidation } from "@/lib/api/response";
import { requestLog } from "@/lib/api/logger";
import { BUSINESS_TIMEZONE_OFFSET_MS } from "@/lib/gl/period";

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
 * - visits：期间内拜访（visitType=VISIT）/ 跟进（visitType!=VISIT，电话/视频/会议/其他）次数（ProjectVisit）
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

  const orderWhere: Prisma.SalesOrderWhereInput = { deletedAt: null, createdAt: range };
  const orderActiveWhere: Prisma.SalesOrderWhereInput = { ...orderWhere, status: { not: "CANCELLED" } };
  const quotationWhere: Prisma.QuotationWhereInput = { deletedAt: null, createdAt: range, status: { not: "CANCELLED" } };
  const customerWhere: Prisma.BusinessPartnerWhereInput = { deletedAt: null, type: { in: ["CUSTOMER", "BOTH"] } };
  const opportunityWhere: Prisma.ProjectOpportunityWhereInput = { deletedAt: null };
  const visitWhere: Prisma.ProjectVisitWhereInput = { deletedAt: null, visitedAt: range };

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
    prisma.projectVisit.count({ where: { ...visitWhere, visitType: "VISIT" } }),
    prisma.projectVisit.count({ where: { ...visitWhere, visitType: { not: "VISIT" } } }),
  ]);

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
  });
}
