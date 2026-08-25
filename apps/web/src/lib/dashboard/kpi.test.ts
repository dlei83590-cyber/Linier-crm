import { describe, expect, it } from "vitest";
import { buildDashboardKpis, formatTodayCn, greetingForUser } from "./kpi";
import type { OperationsReportData } from "@/lib/reports/operations-types";

/** 真实 API 响应形状的最小 fixture（全部字段与 GET /api/reports/operations 对齐） */
const fixture: OperationsReportData = {
  period: "month",
  range: { from: "2026-08-01T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" },
  salesOrders: { count: 12, amount: "888888.50", byStatus: { DRAFT: 3, CONFIRMED: 9 } },
  quotations: { count: 5, amount: "120000.00" },
  customers: { total: 42, newInPeriod: 3 },
  opportunities: { total: 8, newInPeriod: 2, funnel: { LEAD: 3, QUOTATION: 5 } },
  visits: { visits: 7, followUps: 9 },
  targets: [],
  customerTiers: { total: 42, deal: 5, quoted: 6, opportunity: 7, normal: 24 },
  regions: [],
  brands: [],
  channelAvailable: true,
  channels: [],
};

describe("buildDashboardKpis — 真实数据投影 6 个 KPI", () => {
  const kpis = buildDashboardKpis(fixture);

  it("返回 6 个 KPI（不做满屏 KPI）", () => {
    expect(kpis).toHaveLength(6);
  });

  it("销售金额为 money 模式且原样透传 Decimal 字符串", () => {
    const salesAmount = kpis.find((k) => k.key === "salesAmount");
    expect(salesAmount?.money).toBe(true);
    expect(salesAmount?.value).toBe("888888.50");
  });

  it("数值 KPI 为数字且标签带期间前缀", () => {
    const orderCount = kpis.find((k) => k.key === "salesOrderCount");
    expect(orderCount?.value).toBe(12);
    expect(orderCount?.label).toBe("本月订单数");
    expect(orderCount?.hint).toBeTruthy();
  });

  it("在册客户/商机为存量快照，不含期间前缀", () => {
    expect(kpis.find((k) => k.key === "customerTotal")?.label).toBe("在册客户");
    expect(kpis.find((k) => k.key === "opportunityTotal")?.label).toBe("在册商机");
  });

  it("每个 KPI 都带图标 key", () => {
    for (const k of kpis) {
      expect(k.icon).toBeTruthy();
    }
  });
});

describe("formatTodayCn — 欢迎区日期（浏览器本地时区）", () => {
  it("中文长格式含星期", () => {
    const d = new Date(2026, 7, 20); // 2026-08-20 本地时区
    expect(formatTodayCn(d)).toContain("2026");
    expect(formatTodayCn(d)).toContain("8月");
    expect(formatTodayCn(d)).toContain("星期四");
  });
});

describe("greetingForUser — 欢迎语称谓", () => {
  it("SUPER_ADMIN → 管理员", () => {
    expect(greetingForUser({ name: "张三", roles: ["SUPER_ADMIN"] })).toBe("管理员");
  });
  it("普通用户 → 姓名，缺姓名 → 邮箱，全缺 → 用户", () => {
    expect(greetingForUser({ name: "李四", email: "l@x.com", roles: ["ADMIN"] })).toBe("李四");
    expect(greetingForUser({ email: "a@b.c" })).toBe("a@b.c");
    expect(greetingForUser(null)).toBe("用户");
    expect(greetingForUser(undefined)).toBe("用户");
  });
});
