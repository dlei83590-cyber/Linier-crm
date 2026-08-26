"use client";

/**
 * 经营数据固定看板（FE 2.0 升级，UI-03）— /reports/operations
 *
 * 固定看板（非 BI 平台）：数字卡 + 表格，只读聚合 GET /api/reports/operations?period=day|month|year。
 * 全部指标来自真实数据库聚合（禁止 mock）；某数据源不存在时由后端返回空值/可用性标志，页面显式区分。
 *
 * FE 2.0 升级点：
 * - 页面标题层级统一（24px display-base）+ Section 标题 14px semibold 统一
 * - 数字卡统一 KpiCard（AnimatedNumber/AnimatedMoney，tabular-nums，域 Accent reports）
 * - Loading = 骨架屏（KPI 卡骨架 + 表格骨架行）；Error = ErrorPanel + Retry；Empty = EmptyState
 * - 表格：sticky header + hover 行 + 金额右对齐 tabular-nums + StatusBadge + 分布条
 * - 目标保存成功 = Toast（轻量反馈）；保存失败 = 表单顶部 ErrorPanel
 * RBAC：reports:view；目标维护另需 reports:edit（PermissionGuard + hasPermission）。
 */
import { useCallback, useEffect, useState } from "react";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { AppPage, ErrorPanel, KpiCard, StatusBadge } from "@/components/workspace";
import { type StatusTone } from "@/components/design-system";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingRow, EmptyRow } from "@/components/ui/list-states";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, INPUT_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { formatMoneyValue } from "@/lib/format";
import type { OperationsReportData } from "@/lib/reports/operations-types";
import { IconRefresh, IconTarget } from "@/components/ui/icons";

type Period = "day" | "month" | "year";

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
/** 状态徽章语义色（workspace StatusBadge toneMap） */
const SO_STATUS_TONES: Record<string, StatusTone> = {
  DRAFT: "neutral",
  CONFIRMED: "success",
  PARTIALLY_DELIVERED: "warning",
  DELIVERED: "info",
  COMPLETED: "success",
  CANCELLED: "danger",
};
const SO_STATUS_BAR: Record<string, string> = {
  DRAFT: "bg-slate-400",
  CONFIRMED: "bg-emerald-500",
  PARTIALLY_DELIVERED: "bg-amber-500",
  DELIVERED: "bg-sky-500",
  COMPLETED: "bg-emerald-600",
  CANCELLED: "bg-rose-500",
};

// 目标指标标签（ReportTarget.dimensionType → 中文名；白名单与 lib/reports/constants 一致）
const TARGET_DIMENSION_ORDER = [
  "SALES_AMOUNT",
  "NEW_CUSTOMERS",
  "NEW_OPPORTUNITIES",
  "QUOTATIONS",
  "VISITS",
  "FOLLOW_UPS",
] as const;
const TARGET_LABELS: Record<string, string> = {
  SALES_AMOUNT: "销售金额",
  NEW_CUSTOMERS: "新增客户",
  NEW_OPPORTUNITIES: "新增商机",
  QUOTATIONS: "报价数量",
  VISITS: "拜访次数",
  FOLLOW_UPS: "跟进次数",
};

// 客户分层（事实计算，非 AI）：有成交 > 有报价未成交 > 有商机无报价 > 普通客户
const TIER_ROWS: { key: keyof OperationsReportData["customerTiers"]; label: string; hint: string }[] = [
  { key: "deal", label: "有成交", hint: "存在非草稿/非取消销售订单" },
  { key: "quoted", label: "有报价未成交", hint: "存在非取消报价，无成交" },
  { key: "opportunity", label: "有商机无报价", hint: "存在商机，无报价无成交" },
  { key: "normal", label: "普通客户", hint: "其余在册客户" },
];

/** 期间键（Asia/Shanghai 业务日，与后端 lib/reports/constants.reportPeriodKey 一致；ADR-0044） */
function currentPeriodKey(period: Period): string {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  if (period === "day") return `${y}-${m}-${d}`;
  if (period === "month") return `${y}-${m}`;
  return `${y}`;
}

function rateTone(rate: number | null): string {
  if (rate === null) return "text-ink-muted";
  if (rate >= 100) return "text-emerald-600";
  if (rate >= 60) return "text-amber-600";
  return "text-rose-600";
}

/** 表格外壳：sticky header + 纵向滚动（max-h 内滚动）；空态 = EmptyRow（表内） */
function ScrollTable({
  headers,
  children,
  loading,
  colSpan,
  emptyMessage = "暂无数据",
  showEmpty = false,
}: {
  headers: React.ReactNode;
  children: React.ReactNode;
  loading?: boolean;
  colSpan: number;
  emptyMessage?: string;
  /** 数据为空时显示表内 EmptyRow（Error/Empty 与真实数据严格区分） */
  showEmpty?: boolean;
}) {
  return (
    <div className="max-h-[480px] overflow-auto">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="sticky top-0 z-10 bg-surface/95 backdrop-blur">
          <tr className="text-left text-xs font-medium text-ink-secondary">{headers}</tr>
        </thead>
        {loading ? (
          <tbody className="divide-y divide-border">
            <LoadingRow colSpan={colSpan} />
          </tbody>
        ) : (
          <>
            {!showEmpty ? <tbody className="divide-y divide-border">{children}</tbody> : null}
            {showEmpty ? (
              <tbody>
                <EmptyRow colSpan={colSpan} message={emptyMessage} />
              </tbody>
            ) : null}
          </>
        )}
      </table>
    </div>
  );
}

/** 分布条（无图表库；count/max 宽度） */
function DistBar({ value, max, barClass }: { value: number; max: number; barClass: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full min-w-24 overflow-hidden rounded-full bg-canvas">
      <div className={`h-full rounded-full ${barClass}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function OperationsBoard() {
  const toast = useToast();
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];
  const canEditTarget = hasPermission(roles, actionPermission("reports", "edit"));

  const [period, setPeriod] = useState<Period>("month");
  const [data, setData] = useState<OperationsReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  // 经营目标维护表单（reports:edit）
  const [targetPeriod, setTargetPeriod] = useState<string>(() => currentPeriodKey("month"));
  const [targetDimensionType, setTargetDimensionType] = useState<string>("SALES_AMOUNT");
  const [targetAmountInput, setTargetAmountInput] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiClientError | null>(null);

  const load = useCallback((p: Period) => {
    setLoading(true);
    setError(null);
    apiFetch<OperationsReportData>(`/api/reports/operations?period=${p}`)
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
    setTargetPeriod(currentPeriodKey(p));
  };

  const handleSaveTarget = () => {
    if (saving) return;
    const amount = Number(targetAmountInput);
    if (!targetPeriod.trim() || !Number.isFinite(amount) || amount <= 0) {
      setSaveError(new ApiClientError(422, "期间必填，目标金额必须为正数", "VALIDATION_ERROR"));
      return;
    }
    setSaving(true);
    setSaveError(null);
    apiFetch("/api/reports/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        period: targetPeriod.trim(),
        dimensionType: targetDimensionType,
        targetAmount: amount,
      }),
    })
      .then(() => {
        setSaving(false);
        toast.success(
          "目标已保存",
          `「${TARGET_LABELS[targetDimensionType] ?? targetDimensionType}」目标已保存（${targetPeriod.trim()}），达成率已刷新`,
        );
        load(period); // 保存后刷新达成率（requirement：保存后刷新）
      })
      .catch((err: unknown) => {
        setSaving(false);
        setSaveError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
      });
  };

  const pLabel = PERIOD_LABELS[period];
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
        label: SO_STATUS_LABELS[s] ?? s,
        count: data.salesOrders.byStatus[s] ?? 0,
      }))
    : [];
  const statusMax = statusRows.reduce((m, r) => Math.max(m, r.count), 0);

  const kpiCards = data
    ? [
        { key: "orderCount", label: `${pLabel}订单数量`, value: data.salesOrders.count, hint: "不含草稿/已取消" },
        { key: "salesAmount", label: `${pLabel}销售金额`, value: data.salesOrders.amount ?? "0", money: true, hint: "不含草稿/已取消" },
        { key: "customerTotal", label: "客户数量", value: data.customers.total, hint: "在册客户（含兼供）" },
        { key: "customerNew", label: `${pLabel}新增客户`, value: data.customers.newInPeriod },
        { key: "opportunityTotal", label: "商机数量", value: data.opportunities.total, hint: "在册商机" },
        { key: "opportunityNew", label: `${pLabel}新增商机`, value: data.opportunities.newInPeriod },
        { key: "quotationCount", label: `${pLabel}报价数量`, value: data.quotations.count, hint: "不含已取消报价" },
        { key: "quotationAmount", label: `${pLabel}报价金额`, value: data.quotations.amount ?? "0", money: true, hint: "不含已取消报价" },
        { key: "visitCount", label: `${pLabel}拜访次数`, value: data.visits.visits, hint: "定位签到（CustomerActivity）" },
        { key: "followUpCount", label: `${pLabel}跟进次数`, value: data.visits.followUps, hint: "电话/视频/会议等" },
      ]
    : [];

  const th = "px-4 py-2.5 font-medium";
  const td = "px-4 py-2.5";
  const tdRight = "px-4 py-2.5 text-right tabular-nums";

  return (
    <AppPage>
      {/* 页面标题（24px display-base）+ 周期/刷新 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-primary">经营数据看板</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            固定经营看板（只读聚合，真实数据）：订单/客户/商机/报价/走访与跟进/分层/区域/品牌
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
          <button type="button" onClick={() => load(period)} className={BUTTON_SECONDARY_CLASS}>
            <IconRefresh className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
            {loading ? "加载中…" : "刷新"}
          </button>
        </div>
      </div>

      {error ? <div className="mb-4"><ErrorPanel error={error} onRetry={() => load(period)} /></div> : null}

      {data && !error ? (
        <div className="space-y-4">
          {/* 数字卡（KpiCard，域 Accent reports） */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {kpiCards.map((k) => (
              <KpiCard
                key={k.key}
                label={k.label}
                value={k.value}
                money={k.money}
                prefix={k.money ? "¥" : undefined}
                hint={k.hint}
                iconClass="bg-domain-reports-50 text-domain-reports-600"
                icon={<IconTarget className="h-4 w-4" />}
              />
            ))}
          </div>

          {/* 目标达成率（空态也保留设置目标入口） */}
          <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevation-sm">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-ink-primary">目标达成率（{pLabel}）</h2>
              <p className="mt-0.5 text-xs text-ink-secondary">
                目标值来自 ReportTarget（静态配置），实际为本期真实聚合；达成率 = 实际 ÷ 目标；期间键 {currentPeriodKey(period)}
              </p>
            </div>
            {data.targets.length > 0 ? (
              <ScrollTable
                colSpan={4}
                headers={
                  <>
                    <th className={th}>指标</th>
                    <th className={`${tdRight}`}>目标值</th>
                    <th className={`${tdRight}`}>实际值</th>
                    <th className={`${tdRight}`}>达成率</th>
                  </>
                }
              >
                {data.targets.map((t) => (
                  <tr key={t.id} className="transition-colors hover:bg-surface-hover">
                    <td className={td + " text-ink-primary"}>{TARGET_LABELS[t.dimensionType] ?? t.dimensionType}</td>
                    <td className={tdRight + " text-ink-primary"}>{formatMoneyValue(t.targetAmount)}</td>
                    <td className={tdRight + " text-ink-primary"}>{formatMoneyValue(t.actual)}</td>
                    <td className={`${tdRight} font-medium ${rateTone(t.rate)}`}>
                      {t.rate === null ? "—" : t.rate.toFixed(1) + "%"}
                    </td>
                  </tr>
                ))}
              </ScrollTable>
            ) : (
              <EmptyState
                title={`暂未设置${pLabel}目标`}
                description={
                  canEditTarget
                    ? "使用下方「经营目标维护」为本期设置目标，保存后达成率自动显示。"
                    : "请联系具备 reports:edit 权限的管理员配置经营目标。"
                }
                icon={<IconTarget className="h-6 w-6" />}
              />
            )}
          </section>

          {/* 经营目标维护（reports:edit 可见；调已有 POST /api/reports/targets） */}
          {canEditTarget ? (
            <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevation-sm">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-ink-primary">经营目标维护（{pLabel}）</h2>
                <p className="mt-0.5 text-xs text-ink-secondary">
                  目标键 = 期间 + 指标（全局维度 ALL）；仅静态配置目标值，实际值仍来自真实业务聚合；保存后刷新达成率
                </p>
              </div>
              <div className="p-4">
                {saveError ? (
                  <div className="mb-4">
                    <ErrorPanel error={saveError} onRetry={handleSaveTarget} />
                  </div>
                ) : null}
                <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-ink-secondary">期间（YYYY / YYYY-MM / YYYY-MM-DD）</span>
                    <input
                      type="text"
                      value={targetPeriod}
                      onChange={(e) => setTargetPeriod(e.target.value)}
                      placeholder="YYYY-MM"
                      className={INPUT_CLASS}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-ink-secondary">指标</span>
                    <select
                      value={targetDimensionType}
                      onChange={(e) => setTargetDimensionType(e.target.value)}
                      className={SELECT_CLASS}
                    >
                      {TARGET_DIMENSION_ORDER.map((t) => (
                        <option key={t} value={t}>{TARGET_LABELS[t] ?? t}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-ink-secondary">目标金额/数量</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={targetAmountInput}
                      onChange={(e) => setTargetAmountInput(e.target.value)}
                      placeholder="例如 100000"
                      className={INPUT_CLASS}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleSaveTarget}
                    disabled={saving}
                    className={BUTTON_PRIMARY_CLASS + " h-9"}
                  >
                    {saving ? "保存中…" : "保存目标"}
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          {/* 客户分层 */}
          <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevation-sm">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-ink-primary">客户分层（在册客户 · 事实计算）</h2>
              <p className="mt-0.5 text-xs text-ink-secondary">
                有成交（非草稿/非取消订单）→ 有报价未成交 → 有商机无报价 → 普通客户；共 {data.customerTiers.total} 家
              </p>
            </div>
            <ScrollTable
              colSpan={2}
              headers={
                <>
                  <th className={th}>层级</th>
                  <th className={`${tdRight}`}>客户数</th>
                </>
              }
            >
              {TIER_ROWS.map((r) => (
                <tr key={r.key} className="transition-colors hover:bg-surface-hover">
                  <td className={td + " text-ink-primary"}>
                    {r.label}
                    <span className="ml-2 text-xs text-ink-muted">{r.hint}</span>
                  </td>
                  <td className={tdRight + " text-ink-primary"}>{data.customerTiers[r.key]}</td>
                </tr>
              ))}
            </ScrollTable>
          </section>

          {/* 区域分布 + 品牌分布 */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevation-sm">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-ink-primary">区域分布（{pLabel}）</h2>
                <p className="mt-0.5 text-xs text-ink-secondary">
                  BusinessPartner.region 维度：区域客户数 + 期间订单数/金额（未设置区域归「未设置」）
                </p>
              </div>
              <ScrollTable
                colSpan={4}
                showEmpty={data.regions.length === 0}
                emptyMessage="暂无区域分布数据"
                headers={
                  <>
                    <th className={th}>区域</th>
                    <th className={`${tdRight}`}>客户数</th>
                    <th className={`${tdRight}`}>订单数</th>
                    <th className={`${tdRight}`}>订单金额</th>
                  </>
                }
              >
                {data.regions.map((r) => (
                  <tr key={r.region} className="transition-colors hover:bg-surface-hover">
                    <td className={td + " text-ink-primary"}>{r.region}</td>
                    <td className={tdRight + " text-ink-primary"}>{r.customerCount}</td>
                    <td className={tdRight + " text-ink-primary"}>{r.salesOrderCount}</td>
                    <td className={tdRight + " text-ink-primary"}>¥{formatMoneyValue(r.salesAmount)}</td>
                  </tr>
                ))}
              </ScrollTable>
            </section>

            <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevation-sm">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-ink-primary">品牌分布（{pLabel}）</h2>
                <p className="mt-0.5 text-xs text-ink-secondary">
                  SalesOrderLine → Item.brand 真实事实源：品牌行数 + 金额（未设置品牌归「未设置」）
                </p>
              </div>
              <ScrollTable
                colSpan={3}
                showEmpty={data.brands.length === 0}
                emptyMessage="暂无品牌分布数据"
                headers={
                  <>
                    <th className={th}>品牌</th>
                    <th className={`${tdRight}`}>行数</th>
                    <th className={`${tdRight}`}>金额</th>
                  </>
                }
              >
                {data.brands.map((b) => (
                  <tr key={b.brand} className="transition-colors hover:bg-surface-hover">
                    <td className={td + " text-ink-primary"}>{b.brand}</td>
                    <td className={tdRight + " text-ink-primary"}>{b.lineCount}</td>
                    <td className={tdRight + " text-ink-primary"}>¥{formatMoneyValue(b.amount)}</td>
                  </tr>
                ))}
              </ScrollTable>
            </section>
          </div>

          {/* 渠道维度（cc-08-channel）：BusinessPartner.channel 固定枚举 SSOT → 客户数 + 期间订单数/金额 */}
          <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevation-sm">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-ink-primary">渠道分布（${pLabel}）</h2>
              <p className="mt-0.5 text-xs text-ink-secondary">
                BusinessPartner.channel 维度：渠道客户数 + 期间订单数/金额（未设置渠道归「未设置」）
              </p>
            </div>
            <ScrollTable
              colSpan={4}
              showEmpty={data.channels.length === 0}
              emptyMessage="暂无渠道分布数据"
              headers={
                <>
                  <th className={th}>渠道</th>
                  <th className={`${tdRight}`}>客户数</th>
                  <th className={`${tdRight}`}>订单数</th>
                  <th className={`${tdRight}`}>订单金额</th>
                </>
              }
            >
              {data.channels.map((c) => (
                <tr key={c.channel} className="transition-colors hover:bg-surface-hover">
                  <td className={td + " text-ink-primary"}>{c.channel}</td>
                  <td className={tdRight + " text-ink-primary"}>{c.customerCount}</td>
                  <td className={tdRight + " text-ink-primary"}>{c.salesOrderCount}</td>
                  <td className={tdRight + " text-ink-primary"}>¥{formatMoneyValue(c.salesAmount)}</td>
                </tr>
              ))}
            </ScrollTable>
          </section>

          {/* 商机阶段漏斗 + 销售订单状态分布 */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevation-sm">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-ink-primary">商机阶段漏斗（在册按阶段）</h2>
              </div>
              <ScrollTable
                colSpan={3}
                showEmpty={funnelRows.length === 0}
                emptyMessage="暂无商机数据"
                headers={
                  <>
                    <th className={th}>阶段</th>
                    <th className={`${tdRight}`}>数量</th>
                    <th className={th}>分布</th>
                  </>
                }
              >
                {funnelRows.map((r) => (
                  <tr key={r.stage} className="transition-colors hover:bg-surface-hover">
                    <td className={td + " text-ink-primary"}>{r.label}</td>
                    <td className={tdRight + " text-ink-primary"}>{r.count}</td>
                    <td className={td}>
                      <DistBar value={r.count} max={funnelMax} barClass="bg-domain-reports-500" />
                    </td>
                  </tr>
                ))}
              </ScrollTable>
            </section>

            <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevation-sm">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-ink-primary">销售订单状态分布（期间内）</h2>
              </div>
              <ScrollTable
                colSpan={3}
                showEmpty={statusRows.length === 0}
                emptyMessage="暂无订单数据"
                headers={
                  <>
                    <th className={th}>状态</th>
                    <th className={`${tdRight}`}>数量</th>
                    <th className={th}>分布</th>
                  </>
                }
              >
                {statusRows.map((r) => (
                  <tr key={r.status} className="transition-colors hover:bg-surface-hover">
                    <td className={td}>
                      <StatusBadge
                        status={r.status}
                        label={SO_STATUS_LABELS[r.status]}
                        toneMap={SO_STATUS_TONES}
                      />
                    </td>
                    <td className={tdRight + " text-ink-primary"}>{r.count}</td>
                    <td className={td}>
                      <DistBar value={r.count} max={statusMax} barClass={SO_STATUS_BAR[r.status] ?? "bg-slate-400"} />
                    </td>
                  </tr>
                ))}
              </ScrollTable>
            </section>
          </div>
        </div>
      ) : null}

      {/* 首屏加载骨架（无数据时） */}
      {loading && !data && !error ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl border border-border bg-surface" />
            ))}
          </div>
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        </div>
      ) : null}
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
