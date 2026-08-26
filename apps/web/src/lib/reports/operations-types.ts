/**
 * 经营数据固定看板 — 共享数据类型（UI-03 Dashboard & Reports 共用）
 *
 * 与 GET /api/reports/operations?period=day|month|year 的响应体一一对应
 * （服务端只读聚合，金额一律 Decimal 字符串返回，禁止 toNumber）。
 * Dashboard KPI 区 / 经营看板页共同消费，避免两处维护第二份契约。
 */
export interface OperationsReportTarget {
  id: string;
  dimensionType: string;
  dimensionValue: string;
  targetAmount: string;
  actual: string;
  rate: number | null;
}

export interface OperationsReportData {
  period: "day" | "month" | "year";
  range: { from: string; to: string };
  salesOrders: { count: number; amount: string | null; byStatus: Record<string, number> };
  quotations: { count: number; amount: string | null };
  customers: { total: number; newInPeriod: number };
  opportunities: { total: number; newInPeriod: number; funnel: Record<string, number> };
  visits: { visits: number; followUps: number };
  targets: OperationsReportTarget[];
  customerTiers: { total: number; deal: number; quoted: number; opportunity: number; normal: number };
  regions: { region: string; customerCount: number; salesOrderCount: number; salesAmount: string }[];
  brands: { brand: string; lineCount: number; amount: string }[];
  channelAvailable: boolean;
  /** 渠道维度（BusinessPartner.channel 固定枚举；未设置归「未设置」） */
  channels: { channel: string; customerCount: number; salesOrderCount: number; salesAmount: string }[];
}
