"use client";

/**
 * 经营数据固定看板（feat(crm) MVP）— /reports/operations
 *
 * 固定看板（非 BI 平台）：数字卡 + 普通表格，只读聚合 GET /api/reports/operations?period=day|month|year。
 * 全部指标来自真实数据库聚合（禁止 mock）；某数据源不存在时由后端返回空值，页面显示占位。
 * RBAC：reports:view（SUPER_ADMIN/ADMIN 静态授权）。
 */
import { useCallback, useEffect, useState } from "react";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { formatMoneyValue } from "@/lib/format";

type Period = "day" | "month" | "year";

interface OperationsData {
  period: Period;
  range: { from: string; to: string };
  salesOrders: { count: number; amount: string | null; byStatus: Record<string, number> };
  quotations: { count: number; amount: string | null };
  customers: { total: number; newInPeriod: number };
  opportunities: { total: number; newInPeriod: number; funnel: Record<string, number> };
  visits: { visits: number; followUps: number };
  targets: {
    id: string;
    dimensionType: string;
    dimensionValue: string;
    targetAmount: string;
    actual: string;
    rate: number | null;
  }[];
  customerTiers: { total: number; deal: number; quoted: number; opportunity: number; normal: number };
  regions: { region: string; customerCount: number; salesOrderCount: number; salesAmount: string }[];
}

const PERIOD_LABELS: Record<Period, string> = { day: "今日", month: "本月", year: "本年" };

const STAGE_LABELS: Record<string, string> = {
  LEAD: "线索",
  QUALIFIED: "准入",
  SOLUTION: "方案",
  QUOTATION: "报价",
  SAMPLING: "试样",
  TESTING: "测试",
  SMALL_BATCH: "小批量",
  MASS_SUPPLY: "批量供货",
  PAUSED: "暂停",
  FAILED: "失败",
  CLOSED: "结项",
};
const STAGE_ORDER = [
  "LEAD", "QUALIFIED", "SOLUTION", "QUOTATION", "SAMPLING",
  "TESTING", "SMALL_BATCH", "MASS_SUPPLY", "PAUSED", "FAILED", "CLOSED",
];

const SO_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  CONFIRMED: "已确认",
  PARTIALLY_DELIVERED: "部分交付",
  DELIVERED: "已交付",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};
const SO_STATUS_ORDER = ["DRAFT", "CONFIRMED", "PARTIALLY_DELIVERED", "DELIVERED", "COMPLETED", "CANCELLED"];

// 目标指标标签（ReportTarget.dimensionType → 中文名；Migration 0051）
const TARGET_LABELS: Record<string, string> = {
  SALES_AMOUNT: "销售金额",
  NEW_CUSTOMERS: "新增客户",
  NEW_OPPORTUNITIES: "新增商机",
  QUOTATIONS: "报价数量",
  VISITS: "拜访次数",
  FOLLOW_UPS: "跟进次数",
};

// 客户分层（事实计算，非 AI）：有成交 > 有报价未成交 > 有商机无报价 > 普通客户
const TIER_ROWS: { key: keyof OperationsData["customerTiers"]; label: string; hint: string }[] = [
  { key: "deal", label: "有成交", hint: "存在非草稿/非取消销售订单" },
  { key: "quoted", label: "有报价未成交", hint: "存在非取消报价，无成交" },
  { key: "opportunity", label: "有商机无报价", hint: "存在商机，无报价无成交" },
  { key: "normal", label: "普通客户", hint: "其余在册客户" },
];

function rateTone(rate: number | null): string {
  if (rate === null) return "text-ink-muted";
  if (rate >= 100) return "text-emerald-600";
  if (rate >= 60) return "text-amber-600";
  return "text-rose-600";
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-elevation-sm">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-2 truncate text-2xl font-semibold tabular-nums text-ink-primary">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-secondary">{hint}</p> : null}
    </div>
  );
}

function OperationsBoard() {
  const [period, setPeriod] = useState<Period>("month");
  const [data, setData] = useState<OperationsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  const load = useCallback((p: Period) => {
    setLoading(true);
    setError(null);
    apiFetch<OperationsData>(`/api/reports/operations?period=${p}`)
      .then((body) => {
        setData(body.data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load(period);
  }, [period, load]);

  const applyPeriod = (p: Period) => {
    setPeriod(p);
  };

  const pLabel = PERIOD_LABELS[period];
  const funnelRows = data
    ? STAGE_ORDER.filter((s) => (data.opportunities.funnel[s] ?? 0) > 0).map((s) => ({
        stage: s,
        label: STAGE_LABELS[s] ?? s,
        count: data.opportunities.funnel[s] ?? 0,
      }))
    : [];
  const statusRows = data
    ? SO_STATUS_ORDER.filter((s) => (data.salesOrders.byStatus[s] ?? 0) > 0).map((s) => ({
        status: s,
        label: SO_STATUS_LABELS[s] ?? s,
        count: data.salesOrders.byStatus[s] ?? 0,
      }))
    : [];

  return (
    <AppPage>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
        <div>
          <h1 className="text-lg font-semibold text-ink-primary">经营数据看板</h1>
          <p className="text-sm text-ink-secondary">
            固定经营看板（只读聚合，真实数据）：订单/客户/商机/报价/走访与跟进
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={(e) => applyPeriod(e.target.value as Period)}
            className={SELECT_CLASS}
            aria-label="统计周期"
          >
            <option value="day">今天</option>
            <option value="month">本月</option>
            <option value="year">本年</option>
          </select>
          <button type="button" onClick={() => load(period)} className={BUTTON_PRIMARY_CLASS}>
            {loading ? "加载中…" : "刷新"}
          </button>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {loading && !data ? <p className="text-sm text-ink-secondary">加载中…</p> : null}
        {error ? <ErrorPanel error={error} onRetry={() => load(period)} /> : null}

        {data && !loading && !error ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <KpiCard label={`${pLabel}订单数量`} value={String(data.salesOrders.count)} hint="不含已取消订单" />
              <KpiCard label={`${pLabel}销售金额`} value={`¥${formatMoneyValue(data.salesOrders.amount ?? "0")}`} hint="不含已取消订单" />
              <KpiCard label="客户数量" value={String(data.customers.total)} hint="在册客户（含兼供）" />
              <KpiCard label={`${pLabel}新增客户`} value={String(data.customers.newInPeriod)} />
              <KpiCard label="商机数量" value={String(data.opportunities.total)} hint="在册商机" />
              <KpiCard label={`${pLabel}新增商机`} value={String(data.opportunities.newInPeriod)} />
              <KpiCard label={`${pLabel}报价数量`} value={String(data.quotations.count)} hint="不含已取消报价" />
              <KpiCard label={`${pLabel}报价金额`} value={`¥${formatMoneyValue(data.quotations.amount ?? "0")}`} hint="不含已取消报价" />
              <KpiCard label={`${pLabel}拜访次数`} value={String(data.visits.visits)} hint="定位签到（CustomerActivity）" />
              <KpiCard label={`${pLabel}跟进次数`} value={String(data.visits.followUps)} hint="电话/视频/会议等" />
            </div>

{data.targets.length > 0 ? (
<section className="overflow-hidden rounded-lg border border-border bg-surface shadow-elevation-sm">
<div className="border-b border-border px-4 py-3">
<h2 className="text-sm font-semibold text-ink-primary">目标达成率（${pLabel}）</h2>
<p className="text-xs text-ink-secondary">目标值来自 ReportTarget（静态配置），实际为本期真实聚合；达成率 = 实际 ÷ 目标</p>
</div>
<table className="min-w-full divide-y divide-border text-sm">
<thead className="text-left text-xs font-medium text-ink-secondary">
<tr>
<th className="px-4 py-2">指标</th>
<th className="px-4 py-2 text-right">目标值</th>
<th className="px-4 py-2 text-right">实际值</th>
<th className="px-4 py-2 text-right">达成率</th>
</tr>
</thead>
<tbody className="divide-y divide-border">
{data.targets.map((t) => (
<tr key={t.id}>
<td className="px-4 py-2 text-ink-primary">{TARGET_LABELS[t.dimensionType] ?? t.dimensionType}</td>
<td className="px-4 py-2 text-right tabular-nums text-ink-primary">{formatMoneyValue(t.targetAmount)}</td>
<td className="px-4 py-2 text-right tabular-nums text-ink-primary">{formatMoneyValue(t.actual)}</td>
<td className={"px-4 py-2 text-right tabular-nums font-medium " + rateTone(t.rate)}>
{t.rate === null ? "—" : t.rate.toFixed(1) + "%"}
</td>
</tr>
))}
</tbody>
</table>
</section>
) : null}

<section className="overflow-hidden rounded-lg border border-border bg-surface shadow-elevation-sm">
<div className="border-b border-border px-4 py-3">
<h2 className="text-sm font-semibold text-ink-primary">客户分层（在册客户 · 事实计算）</h2>
<p className="text-xs text-ink-secondary">有成交（非草稿/非取消订单）→ 有报价未成交 → 有商机无报价 → 普通客户；共 {data.customerTiers.total} 家</p>
</div>
<table className="min-w-full divide-y divide-border text-sm">
<thead className="text-left text-xs font-medium text-ink-secondary">
<tr>
<th className="px-4 py-2">层级</th>
<th className="px-4 py-2 text-right">客户数</th>
</tr>
</thead>
<tbody className="divide-y divide-border">
{TIER_ROWS.map((r) => (
<tr key={r.key}>
<td className="px-4 py-2 text-ink-primary">
{r.label}
<span className="text-ink-muted ml-2 text-xs">{r.hint}</span>
</td>
<td className="px-4 py-2 text-right tabular-nums text-ink-primary">{data.customerTiers[r.key]}</td>
</tr>
))}
</tbody>
</table>
</section>

<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-elevation-sm">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold text-ink-primary">商机阶段漏斗（在册按阶段）</h2>
                </div>
                {funnelRows.length > 0 ? (
                  <table className="min-w-full divide-y divide-border text-sm">
                    <thead className="text-left text-xs font-medium text-ink-secondary">
                      <tr>
                        <th className="px-4 py-2">阶段</th>
                        <th className="px-4 py-2 text-right">数量</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {funnelRows.map((r) => (
                        <tr key={r.stage}>
                          <td className="px-4 py-2 text-ink-primary">{r.label}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-ink-primary">{r.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="px-4 py-6 text-sm text-ink-secondary">暂无商机数据</p>
                )}
              </section>

              <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-elevation-sm">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold text-ink-primary">销售订单状态分布（期间内）</h2>
                </div>
                {statusRows.length > 0 ? (
                  <table className="min-w-full divide-y divide-border text-sm">
                    <thead className="text-left text-xs font-medium text-ink-secondary">
                      <tr>
                        <th className="px-4 py-2">状态</th>
                        <th className="px-4 py-2 text-right">数量</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {statusRows.map((r) => (
                        <tr key={r.status}>
                          <td className="px-4 py-2 text-ink-primary">{r.label}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-ink-primary">{r.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="px-4 py-6 text-sm text-ink-secondary">暂无订单数据</p>
                )}
              </section>
            </div>
          </>
        ) : null}
      </div>
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("reports", "view")}>
      <OperationsBoard />
    </PermissionGuard>
  );
}