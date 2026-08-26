"use client";

/**
 * UI-05 — 拜访计划周/月视图（现代重构）
 *
 * 领域事实：复用 CustomerActivity VISIT_PLAN（不建新表）；完成反馈 = CHECK_IN.visitPlanId 指向该计划。
 * 数据：GET /api/visits?range=week|month（project-visit:view）。
 * 签到：浏览器 navigator.geolocation → POST /api/business-partners/:id/activities（CHECK_IN + visitPlanId）；
 *       服务端校验客户签到范围（BusinessPartner latitude/longitude/allowedRadiusMeters），
 *       超范围返回 CHECK_IN_OUT_OF_RANGE（明确提示距离/半径）。
 * 签退：POST /api/business-partners/:id/activities/:activityId/checkout（checkoutAt 服务端 now）。
 * 签到成功后服务端自动生成最小 FOLLOW_UP 草稿「签到：时间/位置」（复用 CustomerActivity）。
 *
 * UI-05 升级：
 * - 周/月视图日历化：周一~周日 7 列 / 月网格，今日高亮（brand-50 + 圆形日期徽标），相邻月补位弱化
 * - 视图切换：日历 / 列表（同一份数据两种呈现，判定逻辑共用 resolveVisitRowAction）
 * - 三态统一：加载 = Skeleton 网格 / 列表骨架；失败 = ErrorPanel + Retry；空 = EmptyState + CTA
 * - 签到/签退入口按权限（project-visit:create）与真实 API；状态徽章用 StatusBadge
 * - 范围切换即时生效（segmented control），状态筛选为客户端过滤
 * HOLD：GIS/地图服务/GeoFence Engine/推送平台/日历平台/拖拽排程/路线规划。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import {
  AppPage,
  PageHeader,
  PageToolbar,
  StatusBadge,
  ErrorPanel,
  ProjectSubresourceDialog,
  ReferenceSelector,
  type ReferenceOption,
} from "@/components/workspace";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useListQuery, readUrlFilterParams } from "@/lib/use-list-query";
import { useSession } from "@/lib/session-context";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, INPUT_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { formatDate, formatDateOnly } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { GEOLOCATION_OPTIONS, geolocationErrorMessage } from "@/lib/visit/geolocation";
import {
  chinaDayKey,
  chinaWeekDays,
  chinaMonthGrid,
  groupRowsByDayKey,
  formatPlanTime,
  WEEKDAY_LABELS,
} from "@/lib/visit/calendar";
import { resolveVisitRowAction, latestCheckin } from "@/lib/visit/actions";

interface VisitCheckin {
  id: string;
  visitPlanId: string;
  checkinAt: string | null;
  checkoutAt: string | null;
  latitude: string | null;
  longitude: string | null;
  locationNote: string | null;
  createdById: string | null;
}

interface VisitRow {
  id: string;
  businessPartnerId: string;
  businessPartner: {
    id: string;
    code: string | null;
    name: string | null;
    type: string | null;
    address: string | null;
    region: string | null;
    latitude: string | null;
    longitude: string | null;
    allowedRadiusMeters: number | null;
  };
  planDate: string | null;
  summary: string | null;
  owner: { id: string; name: string | null; email: string | null } | null;
  status: "PENDING" | "COMPLETED";
  checkins: VisitCheckin[];
}

const TYPE_LABELS: Record<string, string> = { CUSTOMER: "客户", SUPPLIER: "供应商", BOTH: "客户兼供应商" };

type ViewMode = "calendar" | "table";
type RangeMode = "week" | "month";

/** 日历单元格内最多展示的计划数（超出折叠为 +N） */
const MAX_CHIPS = 4;

/** 周视图单元格计划卡片 */
function VisitPlanChip({
  row,
  busy,
  canCheckin,
  onCheckin,
  onCheckout,
}: {
  row: VisitRow;
  busy: boolean;
  canCheckin: boolean;
  onCheckin: (row: VisitRow) => void;
  onCheckout: (row: VisitRow) => void;
}) {
  const action = resolveVisitRowAction(row);
  const c = row.businessPartner;
  const isCompleted = row.status === "COMPLETED";
  return (
    <div
      className={
        "rounded-md border px-2 py-1 transition-colors " +
        (isCompleted
          ? "border-status-success-border bg-status-success-bg/50"
          : "border-border bg-surface hover:border-brand-200")
      }
      title={row.summary ? row.summary : undefined}
    >
      <div className="flex items-center gap-1.5">
        <Link
          href={"/business-partners/" + c.id}
          className="flex min-w-0 flex-1 items-center gap-1.5"
        >
          <span
            className={
              "h-1.5 w-1.5 shrink-0 rounded-full " + (isCompleted ? "bg-emerald-500" : "bg-amber-400")
            }
            aria-hidden="true"
          />
          <span className="truncate text-xs font-medium text-ink-primary">{c.name ?? "—"}</span>
        </Link>
        <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">{formatPlanTime(row.planDate)}</span>
      </div>
      <div className="mt-1 flex items-center justify-end gap-1">
        {action === "checkin" && canCheckin ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onCheckin(row)}
            className="rounded border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700 transition-colors hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            签到
          </button>
        ) : action === "checkout" && canCheckin ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onCheckout(row)}
            className="rounded border border-border bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink-secondary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            签退
          </button>
        ) : (
          <span className="text-[11px] text-ink-muted">{isCompleted ? "已完成" : "待拜访"}</span>
        )}
      </div>
    </div>
  );
}

interface PlanCustomerOption {
  id: string;
  code: string | null;
  name: string | null;
  type: string | null;
}

function VisitsList() {
  const toast = useToast();
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];
  const canCheckin = hasPermission(roles, actionPermission("project-visit", "create"));

  const [range, setRange] = useState<RangeMode>("week");
  const [view, setView] = useState<ViewMode>("calendar");
  const [statusInput, setStatusInput] = useState<"" | "PENDING" | "COMPLETED">("");
  const [filters, setFilters] = useState<{ range: string }>({ range: "week" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ApiClientError | null>(null);

  // 创建拜访计划（复用 CustomerActivity VISIT_PLAN；不建新表）
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<ApiClientError | null>(null);
  const [planQuery, setPlanQuery] = useState("");
  const [planSearching, setPlanSearching] = useState(false);
  const [planCustomers, setPlanCustomers] = useState<PlanCustomerOption[]>([]);
  const [planCustomerId, setPlanCustomerId] = useState("");
  const [planDate, setPlanDate] = useState("");
  const [planSummary, setPlanSummary] = useState("");

  // 后端 parsePagination 上限 100：日历按范围拉取，超出时下方给出真实提示（不静默截断）
  const { items, total, page, pageSize, loading, error, setPage, setPageSize, refresh } =
    useListQuery<VisitRow>("/api/visits", filters, 100, { syncUrl: true });
  // URL 筛选恢复（hydration 后一次性应用；刷新/分享后范围不丢失）
  const urlRestored = useRef(false);
  useEffect(() => {
    if (urlRestored.current) return;
    urlRestored.current = true;
    const u = readUrlFilterParams(["range"]);
    const r: RangeMode = u.range === "month" ? "month" : "week";
    setRange(r);
    setFilters({ range: r });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleItems = useMemo(() => {
    if (!statusInput) return items;
    return items.filter((r) => r.status === statusInput);
  }, [items, statusInput]);

  const changeRange = (r: RangeMode) => {
    if (r === range) return;
    setRange(r);
    setFilters({ range: r });
    setPage(1);
    setActionError(null);
  };

  // —— 日历分组（北京时间自然日；与后端 chinaTimeRange 同源）——
  const groupedByDay = useMemo(
    () => groupRowsByDayKey(visibleItems, (r) => chinaDayKey(r.planDate)),
    [visibleItems],
  );
  const weekDays = useMemo(() => chinaWeekDays(), []);
  const monthWeeks = useMemo(() => chinaMonthGrid(), []);

  const locateAndCheckin = (row: VisitRow) => {
    if (!("geolocation" in navigator)) {
      setActionError(new ApiClientError(0, "浏览器不支持定位，无法签到", "GEOLOCATION_UNSUPPORTED"));
      return;
    }
    setBusyId(row.id);
    setActionError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const body = {
          activityType: "CHECK_IN",
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          visitPlanId: row.id,
          locationNote: "拜访签到",
        };
        apiFetch("/api/business-partners/" + row.businessPartnerId + "/activities", {
          method: "POST",
          body: JSON.stringify(body),
        })
          .then(() => {
            refresh();
            setBusyId(null);
            toast.success("签到成功", "计划已反馈为已完成，可进行签退");
          })
          .catch((err: unknown) => {
            // 超范围明确提示（后端返回 CHECK_IN_OUT_OF_RANGE + 距离/半径事实）
            setActionError(err instanceof ApiClientError ? err : new ApiClientError(0, "签到失败", "NETWORK_ERROR"));
            setBusyId(null);
          });
      },
      (err) => {
        // 定位拒绝/信号不可用/超时 → 明确真实原因（FRT-04 错误 UX，禁止静默失败）
        setActionError(new ApiClientError(0, geolocationErrorMessage(err?.code), "GEOLOCATION_ERROR"));
        setBusyId(null);
      },
      GEOLOCATION_OPTIONS,
    );
  };

  const checkout = (row: VisitRow, checkinId: string) => {
    setBusyId(row.id);
    setActionError(null);
    apiFetch("/api/business-partners/" + row.businessPartnerId + "/activities/" + checkinId + "/checkout", {
      method: "POST",
    })
      .then(() => {
        refresh();
        setBusyId(null);
        toast.success("签退成功");
      })
      .catch((err: unknown) => {
        setActionError(err instanceof ApiClientError ? err : new ApiClientError(0, "签退失败", "NETWORK_ERROR"));
        setBusyId(null);
      });
  };

  const openCheckin = (row: VisitRow): VisitCheckin | null => {
    // 最近一次未签退的签到（签退按钮入口）
    return row.checkins.find((c) => c.checkoutAt === null) ?? null;
  };

  const latest = (row: VisitRow): VisitCheckin | null => latestCheckin(row.checkins);

  // —— 创建拜访计划（复用 CustomerActivity VISIT_PLAN；无独立表单页，避免平行 CRUD）——
  const searchPlanCustomers = async () => {
    if (!planQuery.trim()) {
      setCreateError(new ApiClientError(400, "请输入客户名称关键字", "VALIDATION_ERROR"));
      return;
    }
    setPlanSearching(true);
    setCreateError(null);
    try {
      const { data } = await apiFetch<PlanCustomerOption[]>(
        "/api/business-partners?pageSize=10&name=" + encodeURIComponent(planQuery.trim()),
      );
      setPlanCustomers(Array.isArray(data) ? data : []);
      if (!Array.isArray(data) || data.length === 0) {
        setCreateError(new ApiClientError(400, "未找到匹配客户，请更换关键字", "NOT_FOUND"));
      }
    } catch (err: unknown) {
      setCreateError(err instanceof ApiClientError ? err : new ApiClientError(0, "查询客户失败", "NETWORK_ERROR"));
    } finally {
      setPlanSearching(false);
    }
  };

  const submitCreatePlan = async () => {
    if (!planCustomerId) {
      setCreateError(new ApiClientError(400, "请先搜索并选择客户", "VALIDATION_ERROR"));
      return;
    }
    if (!planDate) {
      setCreateError(new ApiClientError(400, "请选择计划日期（必填）", "VALIDATION_ERROR"));
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    try {
      await apiFetch("/api/business-partners/" + planCustomerId + "/activities", {
        method: "POST",
        body: JSON.stringify({
          activityType: "VISIT_PLAN",
          planDate: new Date(planDate).toISOString(),
          summary: planSummary.trim() || undefined,
        }),
      });
      toast.success("拜访计划已创建");
      setCreateOpen(false);
      setPlanCustomerId("");
      setPlanDate("");
      setPlanSummary("");
      setPlanCustomers([]);
      setPlanQuery("");
      refresh();
    } catch (err: unknown) {
      setCreateError(err instanceof ApiClientError ? err : new ApiClientError(0, "创建拜访计划失败", "NETWORK_ERROR"));
    } finally {
      setCreateBusy(false);
    }
  };

  const planCustomerOptions: ReferenceOption[] = planCustomers.map((c) => ({
    value: c.id,
    label: c.name ?? "—",
    hint: c.code ?? "",
  }));

  const segmentClass = (active: boolean) =>
    "rounded-md px-3 py-1 text-xs font-medium transition-colors " +
    (active
      ? "bg-surface text-brand-700 shadow-elevation-sm"
      : "text-ink-secondary hover:text-ink-primary");

  return (
    <AppPage>
      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-elevation-sm">
        <PageHeader
          title="拜访计划"
          description="本周/本月拜访视图（真实 CustomerActivity VISIT_PLAN 数据；签到后计划自动反馈已完成）"
          actions={
            canCheckin ? (
              <button
                type="button"
                onClick={() => {
                  setCreateOpen(true);
                  setCreateError(null);
                }}
                className={BUTTON_PRIMARY_CLASS}
              >
                + 创建拜访计划
              </button>
            ) : undefined
          }
        />
        <PageToolbar>
          <div
            className="inline-flex rounded-md border border-border bg-canvas p-0.5"
            role="group"
            aria-label="时间范围"
          >
            <button type="button" onClick={() => changeRange("week")} className={segmentClass(range === "week")}>
              本周
            </button>
            <button type="button" onClick={() => changeRange("month")} className={segmentClass(range === "month")}>
              本月
            </button>
          </div>
          <div
            className="inline-flex rounded-md border border-border bg-canvas p-0.5"
            role="group"
            aria-label="视图模式"
          >
            <button type="button" onClick={() => setView("calendar")} className={segmentClass(view === "calendar")}>
              日历
            </button>
            <button type="button" onClick={() => setView("table")} className={segmentClass(view === "table")}>
              列表
            </button>
          </div>
          <select
            value={statusInput}
            onChange={(e) => setStatusInput(e.target.value as "" | "PENDING" | "COMPLETED")}
            className={"w-36 " + SELECT_CLASS}
            aria-label="按状态筛选"
          >
            <option value="">全部状态</option>
            <option value="PENDING">待拜访</option>
            <option value="COMPLETED">已完成</option>
          </select>
        </PageToolbar>

        {/* 加载失败（ErrorPanel + Retry，不伪装空态） */}
        {error ? (
          <div className="p-4">
            <ErrorPanel error={error} title="加载拜访计划失败" onRetry={refresh} />
          </div>
        ) : null}

        {/* 日历视图 */}
        {!error && view === "calendar" ? (
          loading ? (
            <div className="grid grid-cols-7 divide-x divide-border">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="min-h-[9rem] space-y-2 p-2">
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ))}
            </div>
          ) : visibleItems.length === 0 ? (
            <EmptyState
              title={range === "week" ? "本周暂无拜访计划" : "本月暂无拜访计划"}
              description="点击右上角「+ 创建拜访计划」，或到客户 360「活动/跟进」Tab 中创建"
              action={
                canCheckin ? (
                  <button
                    type="button"
                    onClick={() => {
                      setCreateOpen(true);
                      setCreateError(null);
                    }}
                    className={BUTTON_PRIMARY_CLASS}
                  >
                    创建拜访计划
                  </button>
                ) : undefined
              }
            />
          ) : range === "week" ? (
            <div className="grid grid-cols-7 divide-x divide-border">
              {weekDays.map((day) => {
                const dayRows = groupedByDay.get(day.key) ?? [];
                const isToday = day.isToday;
                return (
                  <div key={day.key} className={"min-h-[10rem] px-2 py-2 " + (isToday ? "bg-brand-50/60" : "")}>
                    <div className="flex items-center justify-between gap-1">
                      <span className={"text-xs font-medium " + (isToday ? "text-brand-700" : "text-ink-secondary")}>
                        {day.weekdayLabel}
                      </span>
                      <span
                        className={
                          "text-xs tabular-nums " +
                          (isToday
                            ? "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 font-semibold text-white"
                            : "text-ink-muted")
                        }
                      >
                        {day.date}
                      </span>
                    </div>
                    {isToday ? <p className="mt-0.5 text-[11px] font-medium text-brand-600">今天</p> : null}
                    <div className="mt-2 space-y-1.5">
                      {dayRows.slice(0, MAX_CHIPS).map((row) => (
                        <VisitPlanChip
                          key={row.id}
                          row={row}
                          busy={busyId === row.id}
                          canCheckin={canCheckin}
                          onCheckin={locateAndCheckin}
                          onCheckout={(r) => {
                            const ck = openCheckin(r);
                            if (ck) checkout(r, ck.id);
                          }}
                        />
                      ))}
                      {dayRows.length > MAX_CHIPS ? (
                        <p className="text-[11px] text-ink-muted">+{dayRows.length - MAX_CHIPS} 更多</p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-7 border-b border-border bg-canvas text-center text-xs font-semibold text-ink-secondary">
                {WEEKDAY_LABELS.map((l) => (
                  <div key={l} className="px-2 py-2">
                    {l}
                  </div>
                ))}
              </div>
              {monthWeeks.map((week, wi) => (
                <div key={wi} className="grid grid-cols-7 divide-x divide-border border-b border-border last:border-b-0">
                  {week.map((day) => {
                    const dayRows = groupedByDay.get(day.key) ?? [];
                    const isToday = day.isToday;
                    return (
                      <div
                        key={day.key}
                        className={
                          "min-h-[6.5rem] px-2 py-1.5 " +
                          (isToday ? "bg-brand-50/60" : day.inMonth ? "" : "bg-canvas/60")
                        }
                      >
                        <span
                          className={
                            "text-xs tabular-nums " +
                            (isToday
                              ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 font-semibold text-white"
                              : day.inMonth
                                ? "text-ink-primary"
                                : "text-ink-muted/60")
                          }
                        >
                          {day.date}
                        </span>
                        <div className="mt-1 space-y-1">
                          {dayRows.slice(0, 2).map((row) => (
                            <VisitPlanChip
                              key={row.id}
                              row={row}
                              busy={busyId === row.id}
                              canCheckin={canCheckin}
                              onCheckin={locateAndCheckin}
                              onCheckout={(r) => {
                                const ck = openCheckin(r);
                                if (ck) checkout(r, ck.id);
                              }}
                            />
                          ))}
                          {dayRows.length > 2 ? (
                            <p className="text-[11px] text-ink-muted">+{dayRows.length - 2} 更多</p>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )
        ) : null}

        {/* 列表视图 */}
        {!error && view === "table" ? (
          loading ? (
            <div className="space-y-3 p-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-1/4" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-1/3" />
                </div>
              ))}
            </div>
          ) : visibleItems.length === 0 ? (
            <EmptyState
              title={statusInput ? "暂无「" + (statusInput === "COMPLETED" ? "已完成" : "待拜访") + "」的拜访计划" : "当前视图暂无拜访计划"}
              description="调整筛选条件，或点击右上角「+ 创建拜访计划」"
              action={
                canCheckin ? (
                  <button
                    type="button"
                    onClick={() => {
                      setCreateOpen(true);
                      setCreateError(null);
                    }}
                    className={BUTTON_PRIMARY_CLASS}
                  >
                    创建拜访计划
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="sticky top-0 z-10 bg-canvas text-left text-xs font-semibold text-ink-secondary">
                  <tr>
                    <th scope="col" className="px-4 py-3">客户</th>
                    <th scope="col" className="px-4 py-3">计划日期</th>
                    <th scope="col" className="px-4 py-3">负责人</th>
                    <th scope="col" className="px-4 py-3">状态</th>
                    <th scope="col" className="px-4 py-3">签到信息</th>
                    <th scope="col" className="px-4 py-3">拜访目的</th>
                    <th scope="col" className="px-4 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleItems.map((row) => {
                    const c = row.businessPartner;
                    const latestCk = latest(row);
                    const action = resolveVisitRowAction(row);
                    return (
                      <tr key={row.id} className="group transition-colors hover:bg-brand-50/40">
                        <td className="whitespace-nowrap px-4 py-3">
                          <Link href={"/business-partners/" + c.id} className="font-medium text-brand-600 hover:underline">
                            {c.name ?? "—"}
                            <span className="ml-1 text-xs font-normal text-ink-muted">
                              （{c.code}
                              {c.type && TYPE_LABELS[c.type] ? " · " + TYPE_LABELS[c.type] : ""}）
                            </span>
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-secondary">
                          {formatDateOnly(row.planDate)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-secondary">
                          {row.owner?.name ?? row.owner?.email ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <StatusBadge
                            status={row.status}
                            label={row.status === "COMPLETED" ? "已完成" : "待拜访"}
                            tone={row.status === "COMPLETED" ? "success" : "info"}
                          />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-secondary">
                          {latestCk && latestCk.checkinAt ? (
                            <>
                              <span className="tabular-nums">{formatDate(latestCk.checkinAt)}</span>
                              {latestCk.checkoutAt ? (
                                <span className="text-ink-muted"> 签退 {formatDate(latestCk.checkoutAt)}</span>
                              ) : (
                                <span className="text-ink-muted"> 未签退</span>
                              )}
                              {latestCk.locationNote || latestCk.latitude ? (
                                <span className="text-ink-muted">
                                  （{latestCk.locationNote ?? latestCk.latitude + ", " + latestCk.longitude}）
                                </span>
                              ) : null}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="max-w-56 truncate px-4 py-3 text-ink-secondary" title={row.summary ?? undefined}>
                          {row.summary ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            {/* 权限门：签到/签退需 project-visit:create（权限不足不出现假按钮） */}
                            {action === "checkin" && canCheckin ? (
                              <button
                                type="button"
                                disabled={busyId === row.id}
                                onClick={() => locateAndCheckin(row)}
                                className="rounded-md border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {busyId === row.id ? "定位签到中…" : "签到"}
                              </button>
                            ) : null}
                            {action === "checkout" && canCheckin && openCheckin(row) ? (
                              <button
                                type="button"
                                disabled={busyId === row.id}
                                onClick={() => checkout(row, openCheckin(row)!.id)}
                                className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {busyId === row.id ? "处理中…" : "签退"}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {/* 日历数据完整度提示（分页上限 100；不静默截断，提示切换列表分页浏览） */}
        {!error && view === "calendar" && !loading && items.length > 0 && total > items.length ? (
          <p className="border-t border-border px-4 py-2 text-xs text-ink-muted">
            当前视图共 {total} 条拜访计划，仅显示前 {items.length} 条（接口分页上限）；可切换「列表」视图分页浏览。
          </p>
        ) : null}

        {/* 列表视图分页 */}
        {!error && view === "table" && !loading && visibleItems.length > 0 ? (
          <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }} />
        ) : null}

        {/* 动作失败反馈（定位/签到/签退真实错误） */}
        {actionError ? (
          <div className="border-t border-border px-4 py-3">
            <ErrorPanel error={actionError} title="操作未完成" />
          </div>
        ) : null}
      </div>

      {/* 创建拜访计划（复用 CustomerActivity VISIT_PLAN；服务端校验日期必填/权限） */}
      <ProjectSubresourceDialog
        open={createOpen}
        mode="create"
        title="创建拜访计划"
        saving={createBusy}
        error={createError}
        submitDisabled={!planCustomerId || !planDate}
        onSubmit={submitCreatePlan}
        onClose={() => {
          if (!createBusy) {
            setCreateOpen(false);
            setCreateError(null);
          }
        }}
      >
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              value={planQuery}
              onChange={(e) => setPlanQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void searchPlanCustomers();
              }}
              className={INPUT_CLASS + " flex-1"}
              placeholder="客户名称/编码关键字"
            />
            <button
              type="button"
              onClick={() => void searchPlanCustomers()}
              disabled={planSearching}
              className={BUTTON_SECONDARY_CLASS}
            >
              {planSearching ? "查询中…" : "查询"}
            </button>
          </div>
          <ReferenceSelector
            id="plan-customer"
            label="客户"
            required
            value={planCustomerId}
            onChange={setPlanCustomerId}
            options={planCustomerOptions}
            placeholder={planCustomers.length > 0 ? "请选择客户" : "先输入关键字查询"}
            loading={planSearching}
            disabled={planCustomers.length === 0}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="plan-date" className="text-sm font-medium text-ink-secondary">
              计划日期<span className="ml-0.5 text-status-danger-text">*</span>
            </label>
            <input
              id="plan-date"
              type="date"
              value={planDate}
              onChange={(e) => setPlanDate(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <input
            value={planSummary}
            onChange={(e) => setPlanSummary(e.target.value)}
            className={INPUT_CLASS}
            placeholder="拜访目的（可选）"
          />
          <p className="text-xs text-ink-muted">
            创建后显示在当前周/月视图；拜访时在列表/日历行内完成定位签到/签退。
          </p>
        </div>
      </ProjectSubresourceDialog>
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("project-visit", "view")}>
      <VisitsList />
    </PermissionGuard>
  );
}
