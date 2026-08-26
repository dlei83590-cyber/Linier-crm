"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { KpiCard, ErrorPanel } from "@/components/workspace";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import {
  buildDashboardKpis,
  formatTodayCn,
  greetingForUser,
} from "@/lib/dashboard/kpi";
import { buildPendingWork, PENDING_WORK_SOURCES } from "@/lib/dashboard/pending";
import { activityLabel } from "@/lib/dashboard/activity";
import type { OperationsReportData } from "@/lib/reports/operations-types";
import { Donut } from "@/components/ui/charts";
import {
  IconTrendUp,
  IconShoppingCart,
  IconUsers,
  IconUserPlus,
  IconTarget,
  IconMapPin,
  IconActivity,
} from "@/components/ui/icons";

/**
 * Dashboard v2.5 — FE 2.0 现代首页（UI-03，真实数据 / 无 mock）
 *
 * 分区（遵循「无 API 就不显示对应块」）：
 * ① 欢迎 + 当前日期 + 系统状态（/api/health/ready + 构建注入版本）
 * ② 经营概览：4-6 个最重要 KPI + 第二屏客户/商机/订单洞察（GET /api/reports/operations，
 *    reports:view 权限门；金额 Decimal 字符串原样展示，AnimatedMoney/AnimatedNumber）
 * ③ 待处理工作：待确认订单（/api/sales-orders/summary DRAFT）+ 待审批报销
 *    （/api/expenses?status=PENDING → meta.total）——有真实 API 才显示；无 API 数据源不渲染
 * ④ 最近动态：GET /api/audit-logs（audit:view，真实操作记录）
 *
 * 规则保持：不造 backend 不存在的按钮/动作；权限不足不渲染对应区块；
 * 日期只在 hydration 后由浏览器本地时区生成（避免 SSR 跨时区 mismatch）。
 */

type ReportPeriod = "day" | "month" | "year";
const KPI_PERIODS: ReportPeriod[] = ["day", "month", "year"];
const KPI_PERIOD_LABELS: Record<ReportPeriod, string> = { day: "今日", month: "本月", year: "本年" };

/** 单数据源区块状态机（loading → data | error；error 与空态严格区分） */
function useBlock<T>(enabled: boolean, fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcher()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"),
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, nonce, fetcher]);

  return { data, loading, error, reload };
}

interface AuditItem {
  id: string;
  action: string;
  entityType: string;
  result: "SUCCESS" | "FAILURE" | "PARTIAL";
  createdAt: string;
  actor: { id: string; email: string; name: string | null } | null;
}

// 商机阶段 / 订单状态展示元数据（仅展示投影，非业务事实）
const STAGE_LABELS: Record<string, string> = {
  LEAD: "线索", QUALIFIED: "准入", SOLUTION: "方案", QUOTATION: "报价",
  SAMPLING: "试样", TESTING: "测试", SMALL_BATCH: "小批量", MASS_SUPPLY: "批量供货",
  PAUSED: "暂停", FAILED: "失败", CLOSED: "结项",
};
const STAGE_ORDER = [
  "LEAD", "QUALIFIED", "SOLUTION", "QUOTATION", "SAMPLING",
  "TESTING", "SMALL_BATCH", "MASS_SUPPLY", "PAUSED", "FAILED", "CLOSED",
];
// 商机阶段 Donut 分段色（语义 hex，仅展示投影，非业务事实）
const STAGE_COLORS: Record<string, string> = {
  LEAD: "#94a3b8",
  QUALIFIED: "#3b82f6",
  SOLUTION: "#8b5cf6",
  QUOTATION: "#059669",
  SAMPLING: "#f59e0b",
  TESTING: "#06b6d4",
  SMALL_BATCH: "#ea580c",
  MASS_SUPPLY: "#10b981",
  PAUSED: "#64748b",
  FAILED: "#ef4444",
  CLOSED: "#e2e8f0",
};
const SO_STATUS_META: Record<string, { label: string; bar: string }> = {
  DRAFT: { label: "草稿", bar: "bg-slate-400" },
  CONFIRMED: { label: "已确认", bar: "bg-blue-500" },
  PARTIALLY_DELIVERED: { label: "部分交付", bar: "bg-amber-500" },
  DELIVERED: { label: "已交付", bar: "bg-sky-500" },
  COMPLETED: { label: "已完成", bar: "bg-emerald-500" },
  CANCELLED: { label: "已取消", bar: "bg-rose-500" },
};
const SO_STATUS_ORDER = ["DRAFT", "CONFIRMED", "PARTIALLY_DELIVERED", "DELIVERED", "COMPLETED", "CANCELLED"];
// 订单状态 Donut 分段色：由 SO_STATUS_META.bar 类名映射为 hex（展示投影，非业务事实）
const SO_STATUS_BAR_HEX: Record<string, string> = {
  "bg-slate-400": "#94a3b8",
  "bg-blue-500": "#3b82f6",
  "bg-amber-500": "#f59e0b",
  "bg-sky-500": "#0ea5e9",
  "bg-emerald-500": "#10b981",
  "bg-rose-500": "#f43f5e",
};
const FALLBACK_SEGMENT_HEX = "#94a3b8";

const TIER_ROWS: { key: "deal" | "quoted" | "opportunity" | "normal"; label: string; hint: string }[] = [
  { key: "deal", label: "有成交", hint: "存在非草稿/非取消订单" },
  { key: "quoted", label: "有报价未成交", hint: "非取消报价，无成交" },
  { key: "opportunity", label: "有商机无报价", hint: "存在商机，无报价无成交" },
  { key: "normal", label: "普通客户", hint: "其余在册客户" },
];

/** 简单横向条（无图表库；宽度 = count/max，min 2% 保证可见） */
function MiniBar({ value, max, barClass }: { value: number; max: number; barClass: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-canvas">
      <div className={`h-full rounded-full ${barClass}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** 洞察卡容器（Section 标题层级统一：14px semibold） */
function InsightCard({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Bento 网格跨列（如 lg:col-span-2） */
  className?: string;
}) {
  return (
    <section className={"rounded-xl border border-border bg-surface shadow-elevation-sm " + className}>
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-ink-primary">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-ink-secondary">{subtitle}</p> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function SectionTitle({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-base font-semibold text-ink-primary">{title}</h2>
      {meta ? <span className="text-xs text-ink-muted">{meta}</span> : null}
    </div>
  );
}

export default function DashboardPage() {
  const { state } = useSession();
  const user = state.user;
  const roles = (user?.roles ?? []) as RoleCode[];

  const canReports = useMemo(
    () => hasPermission(roles, actionPermission("reports", "view")),
    [roles],
  );
  const canSalesOrders = useMemo(
    () => hasPermission(roles, actionPermission("sales-order", "view")),
    [roles],
  );
  const canExpenses = useMemo(
    () => hasPermission(roles, actionPermission("project-expense", "view")),
    [roles],
  );
  const canAudit = useMemo(
    () => hasPermission(roles, actionPermission("audit", "view")),
    [roles],
  );

  const [today, setToday] = useState("");
  useEffect(() => {
    setToday(formatTodayCn(new Date()));
  }, []);

  const [health, setHealth] = useState<"checking" | "ok" | "down">("checking");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/health/ready")
      .then((r) => {
        if (!cancelled) setHealth(r.ok ? "ok" : "down");
      })
      .catch(() => {
        if (!cancelled) setHealth("down");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [kpiPeriod, setKpiPeriod] = useState<ReportPeriod>("month");
  const periodLabel = KPI_PERIOD_LABELS[kpiPeriod];

  const reportsBlock = useBlock<OperationsReportData>(
    canReports,
    useCallback(
      () =>
        apiFetch<OperationsReportData>(`/api/reports/operations?period=${kpiPeriod}`).then(
          (b) => b.data,
        ),
      [kpiPeriod],
    ),
  );
  const ordersBlock = useBlock<number>(
    canSalesOrders,
    useCallback(
      async () => {
        const b = await apiFetch<{ byStatus: Record<string, number> }>("/api/sales-orders/summary");
        return b.data.byStatus.DRAFT ?? 0;
      },
      [],
    ),
  );
  const expensesBlock = useBlock<number>(
    canExpenses,
    useCallback(
      async () => {
        const b = await apiFetch<unknown>("/api/expenses?status=PENDING&pageSize=1");
        return b.meta?.total ?? 0;
      },
      [],
    ),
  );
  const auditBlock = useBlock<AuditItem[]>(
    canAudit,
    useCallback(
      () => apiFetch<AuditItem[]>("/api/audit-logs?pageSize=5").then((b) => b.data),
      [],
    ),
  );

  const kpis = reportsBlock.data ? buildDashboardKpis(reportsBlock.data, periodLabel) : [];

  const showPendingSection = canSalesOrders || canExpenses;
  const pendingHasError = (canSalesOrders && ordersBlock.error) || (canExpenses && expensesBlock.error);
  // 首屏加载判定：任一启用的数据源仍在加载且尚无数据（避免加载中闪现 0 值卡）
  const pendingLoading =
    (canSalesOrders && ordersBlock.loading && ordersBlock.data === null) ||
    (canExpenses && expensesBlock.loading && expensesBlock.data === null);
  const pendingItems = useMemo(
    () =>
      buildPendingWork(PENDING_WORK_SOURCES, {
        "pending-sales-orders": {
          count: ordersBlock.data ?? 0,
          available: canSalesOrders && ordersBlock.error === null,
        },
        "pending-expenses": {
          count: expensesBlock.data ?? 0,
          available: canExpenses && expensesBlock.error === null,
        },
      }),
    [canSalesOrders, canExpenses, ordersBlock.data, ordersBlock.error, expensesBlock.data, expensesBlock.error],
  );
  const pendingTotal = pendingItems.reduce((sum, i) => sum + i.count, 0);

  const greeting = greetingForUser(user);

  // 洞察数据（第二屏：客户分层 / 商机漏斗 / 订单状态 / 区域分布）
  const data = reportsBlock.data;
  const funnelRows = data
    ? STAGE_ORDER.filter((s) => (data.opportunities.funnel[s] ?? 0) > 0).map((s) => ({
        stage: s,
        label: STAGE_LABELS[s] ?? s,
        count: data.opportunities.funnel[s] ?? 0,
      }))
    : [];
  const funnelMax = funnelRows.reduce((m, r) => Math.max(m, r.count), 0);
  const statusRows = data
    ? SO_STATUS_ORDER.filter((s) => (data.salesOrders.byStatus[s] ?? 0) > 0).map((s) => ({
        status: s,
        label: SO_STATUS_META[s]?.label ?? s,
        bar: SO_STATUS_META[s]?.bar ?? "bg-slate-400",
        count: data.salesOrders.byStatus[s] ?? 0,
      }))
    : [];
  const statusMax = statusRows.reduce((m, r) => Math.max(m, r.count), 0);
  // Donut 投影：复用 funnelRows/statusRows 的过滤（count>0）与排序
  const funnelSegments = funnelRows.map((r) => ({
    value: r.count,
    color: STAGE_COLORS[r.stage] ?? FALLBACK_SEGMENT_HEX,
    label: r.label,
  }));
  const funnelTotal = funnelRows.reduce((sum, r) => sum + r.count, 0);
  const statusSegments = statusRows.map((r) => ({
    value: r.count,
    color: SO_STATUS_BAR_HEX[r.bar] ?? FALLBACK_SEGMENT_HEX,
    label: r.label,
  }));
  const statusTotal = statusRows.reduce((sum, r) => sum + r.count, 0);
  const tierMax = data
    ? Math.max(
        data.customerTiers.deal,
        data.customerTiers.quoted,
        data.customerTiers.opportunity,
        data.customerTiers.normal,
        1,
      )
    : 1;
  const topRegions = data ? data.regions.slice(0, 5) : [];

  return (
    <div className="space-y-6">
      {/* ① 欢迎 + 日期 + 系统状态 */}
      <section className="rounded-xl border border-border bg-surface p-6 shadow-elevation-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink-primary">仪表盘</h1>
            <p className="mt-1 text-sm text-ink-secondary">
              欢迎回来，{greeting}。{today ? `今天是 ${today}。` : ""}
            </p>
          </div>
          <div className="flex items-center gap-5">
            <div className="text-right">
              <p className="text-xs text-ink-muted">发布版本</p>
              <p className="mt-0.5 text-sm font-semibold text-ink-primary">
                {process.env.NEXT_PUBLIC_RELEASE_VERSION ?? "-"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-ink-muted">系统状态</p>
              <p className="mt-0.5 flex items-center justify-end gap-1.5 text-sm font-medium text-ink-primary">
                <span
                  aria-hidden="true"
                  className={`inline-block h-2 w-2 rounded-full ${
                    health === "ok"
                      ? "bg-emerald-500"
                      : health === "down"
                        ? "bg-rose-500"
                        : "bg-amber-400"
                  }`}
                />
                {health === "ok" ? "正常" : health === "down" ? "异常" : "检测中…"}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ② 经营概览：KPI + 客户/商机/订单洞察（reports:view 权限门；无权限不渲染） */}
      {canReports ? (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ink-primary">经营概览</h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                数据来源：经营数据聚合（/api/reports/operations）· 真实只读数据 · 金额含税
              </p>
            </div>
            <div
              className="flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5"
              role="group"
              aria-label="统计周期"
            >
              {KPI_PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setKpiPeriod(p)}
                  aria-pressed={kpiPeriod === p}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors motion-reduce:transition-none ${
                    kpiPeriod === p
                      ? "bg-brand-600 text-white"
                      : "text-ink-secondary hover:bg-surface-hover hover:text-ink-primary"
                  }`}
                >
                  {KPI_PERIOD_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          {reportsBlock.loading && !reportsBlock.data ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-28 animate-pulse rounded-xl border border-border bg-surface" />
              ))}
            </div>
          ) : null}

          {reportsBlock.error ? (
            <ErrorPanel error={reportsBlock.error} onRetry={reportsBlock.reload} />
          ) : null}

          {data && !reportsBlock.error ? (
            <>
              <div className="stagger-grid grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {kpis.map((k) => (
                  <KpiCard
                    key={k.key}
                    label={k.label}
                    value={k.value}
                    money={k.money}
                    prefix={k.money ? "¥" : undefined}
                    hint={k.hint}
                    icon={
                      {
                        "trend-up": <IconTrendUp className="h-4 w-4" />,
                        "shopping-cart": <IconShoppingCart className="h-4 w-4" />,
                        users: <IconUsers className="h-4 w-4" />,
                        "user-plus": <IconUserPlus className="h-4 w-4" />,
                        target: <IconTarget className="h-4 w-4" />,
                        "map-pin": <IconMapPin className="h-4 w-4" />,
                      }[k.icon] ?? null
                    }
                    iconClass="bg-brand-50 text-brand-600"
                  />
                ))}
              </div>

              {/* 第二屏：客户分层 / 商机漏斗 / 订单状态 / 区域分布 */}
              <div className="stagger-grid mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
                <InsightCard
                  className="lg:col-span-1"
                  title="客户分层"
                  subtitle={`在册客户 ${data.customerTiers.total} 家 · 事实计算（成交 > 报价 > 商机 > 普通）`}
                >
                  <div className="space-y-3">
                    {TIER_ROWS.map((r) => (
                      <div key={r.key}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm text-ink-secondary">
                            {r.label}
                            <span className="ml-1.5 text-xs text-ink-muted">{r.hint}</span>
                          </span>
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-primary">
                            {data.customerTiers[r.key]}
                          </span>
                        </div>
                        <div className="mt-1">
                          <MiniBar value={data.customerTiers[r.key]} max={tierMax} barClass="bg-brand-500" />
                        </div>
                      </div>
                    ))}
                  </div>
                </InsightCard>

                <InsightCard
                  className="lg:col-span-2"
                  title={`商机阶段漏斗（${periodLabel}新增 ${data.opportunities.newInPeriod}）`}
                  subtitle="在册商机按阶段快照（真实聚合）"
                >
                  {funnelRows.length > 0 ? (
                    <div className="space-y-3">
                      {funnelRows.map((r) => (
                        <div key={r.stage}>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-sm text-ink-secondary">{r.label}</span>
                            <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-primary">
                              {r.count}
                            </span>
                          </div>
                          <div className="mt-1">
                            <MiniBar value={r.count} max={funnelMax} barClass="bg-brand-600" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="py-6 text-center text-sm text-ink-muted">暂无商机数据</p>
                  )}
                </InsightCard>

                {funnelRows.length > 0 ? (
                  <InsightCard className="lg:col-span-2" title="商机阶段分布" subtitle="在册商机按阶段占比（真实聚合）">
                    <div className="flex flex-col items-center gap-3">
                      <Donut
                        segments={funnelSegments}
                        centerLabel="商机"
                        centerValue={String(funnelTotal)}
                      />
                      <div className="grid w-full grid-cols-2 gap-x-4 gap-y-2">
                        {funnelSegments.map((seg, i) => (
                          <div key={i} className="flex items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-secondary">
                              <span
                                aria-hidden="true"
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: seg.color }}
                              />
                              <span className="truncate">{seg.label}</span>
                            </span>
                            <span className="shrink-0 text-xs font-semibold tabular-nums text-ink-primary">
                              {seg.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </InsightCard>
                ) : null}

                <InsightCard
                  className="lg:col-span-1"
                  title={`销售订单状态（${periodLabel}）`}
                  subtitle={`共 ${data.salesOrders.count} 单 · 不含草稿/已取消`}
                >
                  {statusRows.length > 0 ? (
                    <div className="space-y-3">
                      {statusRows.map((r) => (
                        <div key={r.status}>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-sm text-ink-secondary">{r.label}</span>
                            <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-primary">
                              {r.count}
                            </span>
                          </div>
                          <div className="mt-1">
                            <MiniBar value={r.count} max={statusMax} barClass={r.bar} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="py-6 text-center text-sm text-ink-muted">暂无订单数据</p>
                  )}
                </InsightCard>

                {statusRows.length > 0 ? (
                  <InsightCard className="lg:col-span-1" title="订单状态分布" subtitle="各状态订单数占比（真实聚合）">
                    <div className="flex flex-col items-center gap-3">
                      <Donut
                        segments={statusSegments}
                        centerLabel="订单"
                        centerValue={String(statusTotal)}
                      />
                      <div className="grid w-full grid-cols-2 gap-x-4 gap-y-2">
                        {statusSegments.map((seg, i) => (
                          <div key={i} className="flex items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-secondary">
                              <span
                                aria-hidden="true"
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: seg.color }}
                              />
                              <span className="truncate">{seg.label}</span>
                            </span>
                            <span className="shrink-0 text-xs font-semibold tabular-nums text-ink-primary">
                              {seg.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </InsightCard>
                ) : null}

                <InsightCard
                  className="lg:col-span-2"
                  title="区域分布"
                  subtitle={`区域客户数 + ${periodLabel}订单数/金额（未设置归「未设置」）`}
                >
                  {topRegions.length > 0 ? (
                    <div className="divide-y divide-border">
                      {topRegions.map((r) => (
                        <div key={r.region} className="flex items-center justify-between gap-3 py-2">
                          <span className="truncate text-sm text-ink-secondary">{r.region}</span>
                          <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                            {r.salesOrderCount} 单
                            <span className="ml-3 text-sm font-semibold tabular-nums text-ink-primary">
                              ¥{Number(r.salesAmount).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="py-6 text-center text-sm text-ink-muted">暂无区域分布数据</p>
                  )}
                </InsightCard>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {/* ③ 待处理工作（有真实 API 才显示；无对应权限/API 不渲染） */}
      {showPendingSection ? (
        <section className="rounded-xl border border-border bg-surface p-6 shadow-elevation-sm">
          <SectionTitle
            title="待处理工作"
            meta={pendingTotal > 0 ? `共 ${pendingTotal} 项待处理` : undefined}
          />
          {pendingHasError ? (
            <div className="mt-3 space-y-2">
              {canSalesOrders && ordersBlock.error ? (
                <ErrorPanel error={ordersBlock.error} onRetry={ordersBlock.reload} />
              ) : null}
              {canExpenses && expensesBlock.error ? (
                <ErrorPanel error={expensesBlock.error} onRetry={expensesBlock.reload} />
              ) : null}
            </div>
          ) : pendingLoading ? (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg border border-border bg-surface" />
              ))}
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {pendingItems.map((item) => (
                <Link
                  key={item.key}
                  href={item.route}
                  className="group flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:border-brand-300 hover:bg-brand-50 motion-reduce:transition-none"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-ink-primary">
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          item.tone === "warning" ? "bg-amber-500" : "bg-ink-muted"
                        }`}
                      />
                      {item.label}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-ink-muted">{item.description}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums ${
                      item.tone === "warning" ? "bg-amber-50 text-amber-700" : "bg-canvas text-ink-secondary"
                    }`}
                  >
                    {item.count}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {/* ④ 最近动态（audit:view 权限门） */}
      {canAudit ? (
        <section className="rounded-xl border border-border bg-surface p-6 shadow-elevation-sm">
          <SectionTitle title="最近动态" meta="系统操作日志（最近 5 条）" />
          {auditBlock.loading && !auditBlock.data ? (
            <div className="mt-3 space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : null}
          {auditBlock.error ? (
            <div className="mt-3">
              <ErrorPanel error={auditBlock.error} onRetry={auditBlock.reload} />
            </div>
          ) : null}
          {auditBlock.data && !auditBlock.error ? (
            auditBlock.data.length === 0 ? (
              <EmptyState title="暂无动态" description="系统暂无操作记录。" className="py-8" />
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {auditBlock.data.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 py-2.5">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-canvas text-ink-secondary"
                    >
                      <IconActivity className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-sm ${
                          a.result === "FAILURE" ? "text-rose-600" : "text-ink-primary"
                        }`}
                      >
                        {activityLabel(a.action)}
                        <span className="ml-2 text-xs text-ink-muted">
                          {a.actor?.name ?? a.actor?.email ?? "系统"}
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-ink-muted">{formatDate(a.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </section>
      ) : null}

    </div>
  );
}
