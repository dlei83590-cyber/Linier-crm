import { Prisma } from "@prisma/client";
import { BUSINESS_TIMEZONE_OFFSET_MS } from "@/lib/gl/period";

/**
 * 经营看板固定常量/工具（feat(crm) expense-analytics，Migration 0051）
 * 供 /api/reports/operations 与 /api/reports/targets 共用；避免跨 route 文件 import 常量。
 */

export const REPORT_PERIODS = ["day", "month", "year"] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

/** 支持设定目标的指标（ReportTarget.dimensionType 白名单） */
export const TARGET_DIMENSION_TYPES = [
  "SALES_AMOUNT",
  "NEW_CUSTOMERS",
  "NEW_OPPORTUNITIES",
  "QUOTATIONS",
  "VISITS",
  "FOLLOW_UPS",
] as const;

/** 期间键（ReportTarget.period 约定：day=YYYY-MM-DD / month=YYYY-MM / year=YYYY，Asia/Shanghai 业务日） */
export function reportPeriodKey(period: ReportPeriod, now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + BUSINESS_TIMEZONE_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  if (period === "day") return `${y}-${m}-${d}`;
  if (period === "month") return `${y}-${m}`;
  return `${y}`;
}

/** 达成率 = actual / target × 100%（Decimal 计算，1 位小数；target <= 0 → null）。金额/数量统一字符串口径 */
export function achievementRate(target: string, actual: string | number): number | null {
  const t = new Prisma.Decimal(target);
  if (t.lte(0)) return null;
  const a = new Prisma.Decimal(String(actual));
  return Number(a.div(t).mul(100).toDecimalPlaces(1));
}
