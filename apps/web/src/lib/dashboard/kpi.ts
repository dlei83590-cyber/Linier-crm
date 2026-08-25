/**
 * Dashboard KPI — 纯函数（UI-03，可测试）
 *
 * - buildDashboardKpis：从经营数据聚合（GET /api/reports/operations，真实数据）
 *   投影出 Dashboard 4-6 个最重要 KPI 卡片定义（label/value/hint/icon）。
 * - formatTodayCn：欢迎区当前日期（浏览器本地时区，hydration 后调用）。
 * - greetingForUser：欢迎语称谓（SUPER_ADMIN → 管理员；否则姓名/邮箱/用户）。
 * 本文件只做展示投影，不产生任何业务事实；禁止 mock 数据。
 */
import type { OperationsReportData } from "@/lib/reports/operations-types";

export interface DashboardKpiDef {
  key: string;
  label: string;
  /** 数字（count）或金额字符串（Decimal，money=true） */
  value: number | string;
  /** 金额模式：2 位小数 + 千分位 + ¥ 前缀 */
  money?: boolean;
  hint?: string;
  /** 图标 key（components/ui/icons 消费） */
  icon: string;
}

/** KPI 图标 key → 图标组件映射名（页面侧映射为 ReactNode） */
export const DASHBOARD_KPI_ICONS: Record<string, string> = {
  salesAmount: "trend-up",
  salesOrderCount: "shopping-cart",
  customerTotal: "users",
  customerNew: "user-plus",
  opportunityTotal: "target",
  visitCount: "map-pin",
};

/** 默认统计口径：本月（KPI 文案随 periodLabel 变化） */
export const DASHBOARD_KPI_PERIOD_LABEL = "本月";

/**
 * 从经营数据投影 6 个 Dashboard KPI（全部来自真实聚合；禁止 mock）。
 * 金额以服务端 Decimal 字符串原样透传，页面用 AnimatedMoney 展示。
 */
export function buildDashboardKpis(
  data: OperationsReportData,
  periodLabel: string = DASHBOARD_KPI_PERIOD_LABEL,
): DashboardKpiDef[] {
  return [
    {
      key: "salesAmount",
      label: `${periodLabel}销售金额`,
      value: data.salesOrders.amount ?? "0",
      money: true,
      hint: "不含草稿/已取消订单",
      icon: "trend-up",
    },
    {
      key: "salesOrderCount",
      label: `${periodLabel}订单数`,
      value: data.salesOrders.count,
      hint: "不含草稿/已取消订单",
      icon: "shopping-cart",
    },
    {
      key: "customerTotal",
      label: "在册客户",
      value: data.customers.total,
      hint: "客户 / 客户兼供应商",
      icon: "users",
    },
    {
      key: "customerNew",
      label: `${periodLabel}新增客户`,
      value: data.customers.newInPeriod,
      icon: "user-plus",
    },
    {
      key: "opportunityTotal",
      label: "在册商机",
      value: data.opportunities.total,
      hint: "当前管线快照",
      icon: "target",
    },
    {
      key: "visitCount",
      label: `${periodLabel}拜访`,
      value: data.visits.visits,
      hint: "客户定位签到",
      icon: "map-pin",
    },
  ];
}

/** 欢迎区日期（浏览器本地时区；SSR 阶段不调用，避免 hydration 跨时区 mismatch） */
export function formatTodayCn(date: Date): string {
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

/** 欢迎语称谓：管理员（SUPER_ADMIN）> 姓名 > 邮箱 > 默认 */
export function greetingForUser(
  user: { name?: string | null; email?: string | null; roles?: readonly string[] } | null | undefined,
): string {
  if (!user) return "用户";
  if (user.roles?.includes("SUPER_ADMIN")) return "管理员";
  return user.name ?? user.email ?? "用户";
}
