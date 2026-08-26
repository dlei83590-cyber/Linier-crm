"use client";

/**
 * 绩效数据固定页（FE 2.0 升级，UI-03 + 区域周报）— /reports/performance
 *
 * 只统计客观事实（新增客户/跟进/拜访/商机/报价/成交订单/成交金额），Tab 个人绩效 / 区域周报，
 * 筛选 本周/本月。个人绩效按员工分组；区域周报按真实客户区域 BusinessPartner.region 分组（未设置 → 「未设置」）。
 * 数据源缺失（后端 PERFORMANCE_DATA_SOURCES=false）→ 该列显示「暂无事实数据」，与真实 0 明确区分；
 * 禁止 mock / 主观评分 / 权重 / 奖金算法。所有 API failure 显式 Error + Retry（ErrorPanel）。
 *
 * FE 2.0 升级点：
 * - 顶部数字卡（KpiCard + AnimatedNumber，从真实 rows/regions 汇总，不造数据；数据源缺失的指标不渲染）
 * - Loading = 骨架屏（表格 LoadingRow）；Error = ErrorPanel；Empty = EmptyState
 * - 表格：sticky header + hover 行 + 数值右对齐 tabular-nums + 「暂无事实数据」弱化展示
 * - 页面标题层级统一（24px display-base）
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, ErrorPanel, KpiCard } from "@/components/workspace";
import { LoadingRow, EmptyRow } from "@/components/ui/list-states";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { SELECT_CLASS } from "@/lib/ui-classes";
import { formatMoneyValue } from "@/lib/format";
import {
  IconUsers,
  IconShoppingCart,
  IconTrendUp,
  IconUserPlus,
  IconMapPin,
  IconClock,
  IconLayers,
} from "@/components/ui/icons";

type Period = "week" | "month";
type View = "person" | "region";

interface PerformanceRow {
  userId: string;
  userName: string;
  userEmail: string;
  departmentName: string | null;
  newCustomerCount: number;
  followUpCount: number | null;
  visitCount: number;
  opportunityCount: number;
  quotationCount: number;
  salesOrderCount: number;
  salesAmount: string;
}

interface RegionRow {
  region: string;
  newCustomerCount: number;
  followUpCount: number;
  visitCount: number;
  opportunityCount: number;
  quotationCount: number;
  salesOrderCount: number;
  salesAmount: string;
}

/** 两种视图共用的客观事实指标（person 行与 region 行字段一致） */
type MetricRow = Pick<
  PerformanceRow,
  "newCustomerCount" | "followUpCount" | "visitCount" | "opportunityCount" | "quotationCount" | "salesOrderCount" | "salesAmount"
>;

interface PerformanceData {
  view: View;
  period: Period;
  from: string;
  to: string;
  dataSources: Record<string, boolean>;
  rows: PerformanceRow[];
  regions: RegionRow[];
}

/** 数据源键（与后端 PERFORMANCE_DATA_SOURCES 对齐）：false = 模型不可用 → 列显示「暂无事实数据」而非 0 */
const COLUMN_SOURCES: { key: string; header: string; right?: boolean }[] = [
  { key: "newCustomers", header: "新增客户", right: true },
  { key: "followUps", header: "跟进次数", right: true },
  { key: "visits", header: "拜访次数", right: true },
  { key: "opportunities", header: "商机数", right: true },
  { key: "quotations", header: "报价数", right: true },
  { key: "salesOrders", header: "成交订单", right: true },
  { key: "salesAmount", header: "成交金额", right: true },
];

/** 客观事实指标单元格（person/region 行共用；数据源缺失 → 「暂无事实数据」） */
function MetricCells({
  r,
  ds,
  tdRight,
}: {
  r: MetricRow;
  ds: Record<string, boolean>;
  tdRight: string;
}) {
  return (
    <>
      <td className={tdRight + " text-ink-primary"}>
        {ds.newCustomers ? r.newCustomerCount : <NoFact />}
      </td>
      <td className={tdRight + " text-ink-primary"}>
        {ds.followUps ? (r.followUpCount ?? 0) : <NoFact />}
      </td>
      <td className={tdRight + " text-ink-primary"}>
        {ds.visits ? r.visitCount : <NoFact />}
      </td>
      <td className={tdRight + " text-ink-primary"}>
        {ds.opportunities ? r.opportunityCount : <NoFact />}
      </td>
      <td className={tdRight + " text-ink-primary"}>
        {ds.quotations ? r.quotationCount : <NoFact />}
      </td>
      <td className={tdRight + " text-ink-primary"}>
        {ds.salesOrders ? r.salesOrderCount : <NoFact />}
      </td>
      <td className={tdRight + " text-ink-primary"}>
        {ds.salesAmount ? formatMoneyValue(r.salesAmount) : <NoFact />}
      </td>
    </>
  );
}

/** 从真实 rows/regions 汇总页面级 KPI（数据源缺失的指标剔除，不显示假数字） */
function buildSummaryKpis(data: PerformanceData | null): {
  key: string;
  label: string;
  value: number | string;
  money?: boolean;
  hint?: string;
  icon?: string;
}[] {
  if (!data) return [];
  const ds = data.dataSources;
  const rows: MetricRow[] = data.view === "region" ? data.regions : data.rows;
  const sum = (fn: (r: MetricRow) => number) => rows.reduce((acc, r) => acc + fn(r), 0);
  const kpis: {
    key: string;
    label: string;
    value: number | string;
    money?: boolean;
    hint?: string;
    icon?: string;
  }[] = [
    data.view === "region"
      ? { key: "regions", label: "覆盖区域", value: rows.length, hint: "周期内有业务事实的区域", icon: "regions" }
      : { key: "staff", label: "参与员工", value: rows.length, hint: "周期内活跃用户", icon: "users" },
  ];
  if (ds.salesOrders) {
    kpis.push({ key: "orders", label: "成交订单", value: sum((r) => r.salesOrderCount), hint: "不含草稿/已取消", icon: "orders" });
  }
  if (ds.salesAmount) {
    const money = rows.reduce((acc, r) => acc + Number(r.salesAmount), 0);
    kpis.push({ key: "salesAmount", label: "成交金额", value: String(money), money: true, hint: "成交口径合计", icon: "amount" });
  }
  if (ds.newCustomers) {
    kpis.push({ key: "customers", label: "新增客户", value: sum((r) => r.newCustomerCount), icon: "customers" });
  }
  if (ds.visits) {
    kpis.push({ key: "visits", label: "拜访次数", value: sum((r) => r.visitCount), hint: "客户定位签到", icon: "visits" });
  }
  if (ds.followUps) {
    kpis.push({ key: "followUps", label: "跟进次数", value: sum((r) => r.followUpCount ?? 0), hint: "电话/视频/会议", icon: "followUps" });
  }
  return kpis;
}

function PerformanceBoard() {
  const [view, setView] = useState<View>("person");
  const [period, setPeriod] = useState<Period>("week");
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  const load = useCallback((p: Period, v: View) => {
    setLoading(true);
    setError(null);
    apiFetch<PerformanceData>("/api/reports/performance?period=" + p + "&view=" + v)
      .then((body) => setData(body.data))
      .catch((err: unknown) => setError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载失败", "NETWORK_ERROR")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(period, view);
  }, [period, view, load]);

  const kpis = useMemo(() => buildSummaryKpis(data), [data]);
  const KPI_ICONS: Record<string, React.ReactNode> = {
    users: <IconUsers className="h-4 w-4" />,
    regions: <IconLayers className="h-4 w-4" />,
    orders: <IconShoppingCart className="h-4 w-4" />,
    amount: <IconTrendUp className="h-4 w-4" />,
    customers: <IconUserPlus className="h-4 w-4" />,
    visits: <IconMapPin className="h-4 w-4" />,
    followUps: <IconClock className="h-4 w-4" />,
  };

  const th = "px-4 py-2.5 font-medium";
  const td = "px-4 py-2.5";
  const tdRight = "px-4 py-2.5 text-right tabular-nums";
  const isRegion = view === "region";
  // 表格按实际返回数据（data.view）渲染，切换 Tab 的加载间隙保持列与数据一致（行显示骨架）
  const tableRegion = data?.view === "region";
  const firstColSpan = tableRegion ? COLUMN_SOURCES.length + 1 : COLUMN_SOURCES.length + 2;

  return (
    <AppPage>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-primary">绩效数据</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            客观业务事实统计（本周/本月）；数据源缺失列显示「暂无事实数据」，与 0 明确区分
          </p>
        </div>
        <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className={SELECT_CLASS} aria-label="统计周期">
          <option value="week">本周</option>
          <option value="month">本月</option>
        </select>
      </div>

      {/* Tab：个人绩效 / 区域周报（区域 = 真实客户区域 BusinessPartner.region，未设置 → 「未设置」） */}
      <div className="mb-4 flex items-center gap-1 border-b border-border" role="tablist" aria-label="绩效视图">
        {([
          { key: "person", label: "个人绩效" },
          { key: "region", label: "区域周报" },
        ] as { key: View; label: string }[]).map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={view === t.key}
            onClick={() => setView(t.key)}
            className={"-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors duration-150 ease-out " +
              (view === t.key
                ? "border-brand-600 font-semibold text-brand-700"
                : "border-transparent text-ink-secondary hover:bg-canvas hover:text-ink-primary")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="mb-4"><ErrorPanel error={error} onRetry={() => load(period, view)} /></div>}

      {/* 页面级数字卡（真实 rows/regions 汇总） */}
      {data && !error && kpis.length > 0 ? (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {kpis.map((k) => (
            <KpiCard
              key={k.key}
              label={k.label}
              value={k.value}
              money={k.money}
              prefix={k.money ? "¥" : undefined}
              hint={k.hint}
              icon={KPI_ICONS[k.icon ?? ""] ?? null}
              iconClass="bg-domain-reports-50 text-domain-reports-600"
            />
          ))}
        </div>
      ) : null}

      {/* 首屏加载骨架 */}
      {loading && !data && !error ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl border border-border bg-surface" />
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      ) : null}

      {data && !error ? (
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevation-sm">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-ink-primary">
              {isRegion ? "区域周报" : "员工绩效明细"}（{period === "week" ? "本周" : "本月"}）
            </h2>
            <p className="mt-0.5 text-xs text-ink-secondary">
              {isRegion
                ? "按真实客户区域（BusinessPartner.region）分组；未设置区域归「未设置」；仅展示，不评分"
                : "按员工分组的周期内客观业务事实；仅展示，不评分"}
            </p>
          </div>
          <div className="max-h-[560px] overflow-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="sticky top-0 z-10 bg-surface/95 backdrop-blur">
                <tr className="text-left text-xs font-medium text-ink-secondary">
                  {tableRegion ? <th className={th}>区域</th> : (<><th className={th}>员工</th><th className={th}>部门</th></>)}
                  {COLUMN_SOURCES.map((c) => (
                    <th key={c.key} className={c.right ? tdRight : th}>{c.header}</th>
                  ))}
                </tr>
              </thead>
              {loading ? (
                <tbody className="divide-y divide-border">
                  <LoadingRow colSpan={firstColSpan} />
                </tbody>
              ) : (tableRegion ? data.regions : data.rows).length === 0 ? (
                <tbody>
                  <EmptyRow colSpan={firstColSpan} message={tableRegion ? "暂无区域数据" : "暂无员工数据"} />
                </tbody>
              ) : (
                <tbody className="divide-y divide-border">
                  {(tableRegion ? data.regions : data.rows).map((r) => (
                    <tr key={tableRegion ? (r as RegionRow).region : (r as PerformanceRow).userId} className="transition-colors hover:bg-slate-50">
                      {tableRegion ? (
                        <td className={td + " text-ink-primary"}>
                          <span className="font-medium">{(r as RegionRow).region}</span>
                        </td>
                      ) : (
                        <>
                          <td className={td + " text-ink-primary"}>
                            <span className="font-medium">{(r as PerformanceRow).userName}</span>
                            <span className="ml-2 text-xs text-ink-muted">{(r as PerformanceRow).userEmail}</span>
                          </td>
                          <td className={td + " text-ink-muted"}>{(r as PerformanceRow).departmentName ?? "—"}</td>
                        </>
                      )}
                      <MetricCells r={r as MetricRow} ds={data.dataSources} tdRight={tdRight} />
                    </tr>
                  ))}
                </tbody>
              )}
            </table>
          </div>
        </div>
      ) : null}
    </AppPage>
  );
}

/** 数据源缺失占位（「暂无事实数据」，与真实 0 严格区分） */
function NoFact() {
  return <span className="text-xs text-ink-muted">暂无事实数据</span>;
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("reports", "view")}>
      <PerformanceBoard />
    </PermissionGuard>
  );
}
