"use client";

/**
 * 经营数据固定看板（feat(crm) MVP + FRT-10 Runtime 收口）— /reports/operations
 *
 * 固定看板（非 BI 平台）：数字卡 + 普通表格，只读聚合 GET /api/reports/operations?period=day|month|year。
 * 全部指标来自真实数据库聚合（禁止 mock）；某数据源不存在时由后端返回空值/可用性标志，页面显式区分。
 * FRT-10 收口（本页）：
 * - 区域分布（regions：区域客户数 + 期间订单数/金额）完整显示
 * - 品牌分布（brands：Item.brand 行数/金额）完整显示
 * - channelAvailable=false → 明确「暂无渠道事实数据」（后端无渠道 SSOT 事实源，不造 channel 字段）
 * - 经营目标维护最小 UI（reports:edit 可见）：调已有 GET/POST /api/reports/targets，
 *   period + dimensionType + targetAmount，保存后刷新本页达成率
 * - targets 为空时仍保留设置目标入口（表格区显示空态 + 维护表单常驻）
 * - 所有 report API failure 显式 Error + Retry（ErrorPanel）
 * RBAC：reports:view（SUPER_ADMIN/ADMIN 静态授权）；目标维护另需 reports:edit。
 */
import { useCallback, useEffect, useState } from "react";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { AppPage, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS, INPUT_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
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
  brands: { brand: string; lineCount: number; amount: string }[];
  channelAvailable: boolean;
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

// 目标指标标签（ReportTarget.dimensionType → 中文名；Migration 0051；白名单与 lib/reports/constants 一致）
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
const TIER_ROWS: { key: keyof OperationsData["customerTiers"]; label: string; hint: string }[] = [
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
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];
  const canEditTarget = hasPermission(roles, actionPermission("reports", "edit"));

  const [period, setPeriod] = useState<Period>("month");
  const [data, setData] = useState<OperationsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  // 经营目标维护表单（reports:edit）
  const [targetPeriod, setTargetPeriod] = useState<string>(() => currentPeriodKey("month"));
  const [targetDimensionType, setTargetDimensionType] = useState<string>("SALES_AMOUNT");
  const [targetAmountInput, setTargetAmountInput] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiClientError | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

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
    setSavedNotice(null);
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
        setSavedNotice(`已保存「${TARGET_LABELS[targetDimensionType] ?? targetDimensionType}」目标（${targetPeriod.trim()}），达成率已刷新`);
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

            {/* 目标达成率（空态也保留设置目标入口，requirement ⑤） */}
            <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-elevation-sm">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-ink-primary">目标达成率（{pLabel}）</h2>
                <p className="text-xs text-ink-secondary">
                  目标值来自 ReportTarget（静态配置），实际为本期真实聚合；达成率 = 实际 ÷ 目标；期间键 {currentPeriodKey(period)}
                </p>
              </div>
              {data.targets.length > 0 ? (
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
              ) : (
                <div className="px-4 py-6 text-sm text-ink-secondary">
                  暂未设置{pLabel}目标
                  {canEditTarget ? "——使用下方「经营目标维护」为本期设置目标，保存后达成率自动显示。" : "——请联系具备 reports:edit 权限的管理员配置经营目标。"}
                </div>
              )}
            </section>

            {/* 经营目标维护（reports:edit 可见；调已有 POST /api/reports/targets，requirement ④） */}
            {canEditTarget ? (
              <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-elevation-sm">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold text-ink-primary">经营目标维护（{pLabel}）</h2>
                  <p className="text-xs text-ink-secondary">
                    目标键 = 期间 + 指标（全局维度 ALL）；仅静态配置目标值，实际值仍来自真实业务聚合；保存后刷新达成率
                  </p>
                </div>
                <div className="p-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-ink-secondary">期间（YYYY / YYYY-MM / YYYY-MM-DD）</span>
                      <input
                        type="text"
                        value={targetPeriod}
                        onChange={(e) => setTargetPeriod(e.target.value)}
                        placeholder="YYYY-MM"
                        className={INPUT_CLASS + " w-40"}
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
                        className={INPUT_CLASS + " w-40"}
                      />
                    </label>
                    <button type="button" onClick={handleSaveTarget} disabled={saving} className={BUTTON_PRIMARY_CLASS}>
                      {saving ? "保存中…" : "保存目标"}
                    </button>
                  </div>
                  {savedNotice ? <p className="mt-3 text-sm text-emerald-600">{savedNotice}</p> : null}
                  {saveError ? (
                    <div className="mt-3">
                      <ErrorPanel error={saveError} onRetry={handleSaveTarget} />
                    </div>
                  ) : null}
                </div>
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

            {/* 区域分布 + 品牌分布（requirement ①②） */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-elevation-sm">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold text-ink-primary">区域分布（{pLabel}）</h2>
                  <p className="text-xs text-ink-secondary">BusinessPartner.region 维度：区域客户数 + 期间订单数/金额（未设置区域归「未设置」）</p>
                </div>
                {data.regions.length > 0 ? (
                  <table className="min-w-full divide-y divide-border text-sm">
                    <thead className="text-left text-xs font-medium text-ink-secondary">
                      <tr>
                        <th className="px-4 py-2">区域</th>
                        <th className="px-4 py-2 text-right">客户数</th>
                        <th className="px-4 py-2 text-right">订单数</th>
                        <th className="px-4 py-2 text-right">订单金额</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.regions.map((r) => (
                        <tr key={r.region}>
                          <td className="px-4 py-2 text-ink-primary">{r.region}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-ink-primary">{r.customerCount}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-ink-primary">{r.salesOrderCount}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-ink-primary">¥{formatMoneyValue(r.salesAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="px-4 py-6 text-sm text-ink-secondary">暂无区域分布数据</p>
                )}
              </section>

              <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-elevation-sm">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold text-ink-primary">品牌分布（{pLabel}）</h2>
                  <p className="text-xs text-ink-secondary">SalesOrderLine → Item.brand 真实事实源：品牌行数 + 金额（未设置品牌归「未设置」）</p>
                </div>
                {data.brands.length > 0 ? (
                  <table className="min-w-full divide-y divide-border text-sm">
                    <thead className="text-left text-xs font-medium text-ink-secondary">
                      <tr>
                        <th className="px-4 py-2">品牌</th>
                        <th className="px-4 py-2 text-right">行数</th>
                        <th className="px-4 py-2 text-right">金额</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.brands.map((b) => (
                        <tr key={b.brand}>
                          <td className="px-4 py-2 text-ink-primary">{b.brand}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-ink-primary">{b.lineCount}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-ink-primary">¥{formatMoneyValue(b.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="px-4 py-6 text-sm text-ink-secondary">暂无品牌分布数据</p>
                )}
              </section>
            </div>

            {/* 渠道维度（requirement ③）：channelAvailable=false → 明确「暂无渠道事实数据」，不造 channel 字段 */}
            <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-elevation-sm">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-ink-primary">渠道分布（{pLabel}）</h2>
              </div>
              <p className="px-4 py-6 text-sm text-ink-secondary">
                {data.channelAvailable
                  ? "渠道事实数据可用（按渠道聚合）"
                  : "暂无渠道事实数据：当前渠道维度无 SSOT 事实源（不造 channel 字段），渠道数据接入后自动显示。"}
              </p>
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
