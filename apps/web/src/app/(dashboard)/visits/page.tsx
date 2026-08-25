"use client";

/**
 * Visits — 拜访计划周/月视图（feat(crm) 拜访周/月视图 + 签到规则 MVP）
 *
 * 领域事实：复用 CustomerActivity VISIT_PLAN（不建新表）；完成反馈 = CHECK_IN.visitPlanId 指向该计划。
 * 数据：GET /api/visits?range=week|month（project-visit:view）。
 * 签到：浏览器 navigator.geolocation → POST /api/business-partners/:id/activities（CHECK_IN + visitPlanId）；
 *       服务端校验客户签到范围（BusinessPartner latitude/longitude/allowedRadiusMeters），
 *       超范围返回 CHECK_IN_OUT_OF_RANGE（明确提示距离/半径）。
 * 签退：POST /api/business-partners/:id/activities/:activityId/checkout（checkoutAt 服务端 now）。
 * 签到成功后服务端自动生成最小 FOLLOW_UP 草稿「签到：时间/位置」（复用 CustomerActivity）。
 * HOLD：GIS/地图服务/GeoFence Engine/推送平台/日历平台/拖拽排程/路线规划。
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { AppPage, EntityListWorkspace, ProjectSubresourceDialog, ReferenceSelector, type ReferenceOption } from "@/components/workspace";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useListQuery } from "@/lib/use-list-query";
import { useSession } from "@/lib/session-context";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, INPUT_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { formatDate, formatDateOnly } from "@/lib/format";
import { GEOLOCATION_OPTIONS, geolocationErrorMessage } from "@/lib/visit/geolocation";

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

function VisitStatusBadge({ status }: { status: "PENDING" | "COMPLETED" }) {
  return status === "COMPLETED" ? (
    <span className="inline-flex rounded bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">已完成</span>
  ) : (
    <span className="inline-flex rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">待拜访</span>
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

  const [rangeInput, setRangeInput] = useState<"week" | "month">("week");
  const [statusInput, setStatusInput] = useState<"" | "PENDING" | "COMPLETED">("");
  const [filters, setFilters] = useState<{ range: string }>({ range: "week" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<VisitRow>("/api/visits", filters, 100);

  const visibleItems = useMemo(() => {
    if (!statusInput) return items;
    return items.filter((r) => r.status === statusInput);
  }, [items, statusInput]);

  const applyRange = () => {
    setFilters({ range: rangeInput });
    setPage(1);
    setActionError(null);
  };

  const locateAndCheckin = (row: VisitRow) => {
    if (!("geolocation" in navigator)) {
      setActionError("浏览器不支持定位，无法签到");
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
            setActionError(err instanceof ApiClientError ? err.message : "签到失败");
            setBusyId(null);
          });
      },
      (err) => {
        // 定位拒绝/信号不可用/超时 → 明确真实原因（FRT-04 错误 UX，禁止静默失败）
        setActionError(geolocationErrorMessage(err?.code));
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
        setActionError(err instanceof ApiClientError ? err.message : "签退失败");
        setBusyId(null);
      });
  };

  const openCheckin = (row: VisitRow): VisitCheckin | null => {
    // 最近一次未签退的签到（签退按钮入口）
    return row.checkins.find((c) => c.checkoutAt === null) ?? null;
  };

  const latestCheckin = (row: VisitRow): VisitCheckin | null =>
    row.checkins.length > 0 ? row.checkins[row.checkins.length - 1] : null;

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

  return (
    <AppPage>
      <EntityListWorkspace<VisitRow>
        title="拜访计划"
        description="本月/本周拜访视图（真实 CustomerActivity VISIT_PLAN 数据；签到后计划自动反馈已完成）"
        emptyMessage="当前视图暂无拜访计划——点击右上角「创建拜访计划」，或到客户 360「活动/跟进」Tab 中创建"
        filters={
          <>
            <select value={rangeInput} onChange={(e) => setRangeInput(e.target.value as "week" | "month")} className={"w-40 " + SELECT_CLASS}>
              <option value="week">本周</option>
              <option value="month">本月</option>
            </select>
            <select value={statusInput} onChange={(e) => setStatusInput(e.target.value as "" | "PENDING" | "COMPLETED")} className={"w-36 " + SELECT_CLASS}>
              <option value="">全部状态</option>
              <option value="PENDING">待拜访</option>
              <option value="COMPLETED">已完成</option>
            </select>
          </>
        }
        headerActions={
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
        toolbarActions={
          <button type="button" onClick={applyRange} className={BUTTON_SECONDARY_CLASS}>
            查询
          </button>
        }
        columns={[
          {
            key: "customer",
            header: "客户",
            render: (row) => {
              const c = row.businessPartner;
              if (!c) return "—";
              const typeLabel = c.type ? TYPE_LABELS[c.type] ?? c.type : "";
              return (
                <Link href={"/business-partners/" + c.id} className="text-brand-600 hover:underline">
                  {c.name ?? "—"}
                  <span className="text-ink-muted ml-1 text-xs">
                    （{c.code}
                    {typeLabel ? " · " + typeLabel : ""}）
                  </span>
                </Link>
              );
            },
          },
          {
            key: "planDate",
            header: "计划日期",
            render: (row) => formatDateOnly(row.planDate),
          },
          {
            key: "owner",
            header: "负责人",
            render: (row) => row.owner?.name ?? row.owner?.email ?? "—",
          },
          {
            key: "status",
            header: "状态",
            render: (row) => <VisitStatusBadge status={row.status} />,
          },
          {
            key: "checkinInfo",
            header: "签到信息",
            render: (row) => {
              const c = latestCheckin(row);
              if (!c || !c.checkinAt) return "—";
              const checkinText = formatDate(c.checkinAt);
              const checkoutText = c.checkoutAt ? " 签退 " + formatDate(c.checkoutAt) : " 未签退";
              const loc = c.locationNote ?? (c.latitude ? c.latitude + ", " + c.longitude : "");
              return (
                <span className="text-xs text-ink-secondary">
                  {checkinText}
                  {checkoutText}
                  {loc ? <span className="text-ink-muted">（{loc}）</span> : null}
                </span>
              );
            },
          },
          {
            key: "summary",
            header: "拜访目的",
            render: (row) => row.summary ?? "—",
          },
        ]}
        rows={visibleItems}
        rowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={refresh}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        rowActions={(row) => (
          <div className="flex justify-end gap-1">
            {/* 权限门：签到/签退需 project-visit:create（权限不足不出现假按钮） */}
            {row.status === "PENDING" && canCheckin ? (
              <button
                type="button"
                disabled={busyId === row.id}
                onClick={() => locateAndCheckin(row)}
                className="rounded-md bg-brand-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busyId === row.id ? "定位签到中…" : "签到"}
              </button>
            ) : null}
            {row.status === "COMPLETED" && openCheckin(row) && canCheckin ? (
              <button
                type="button"
                disabled={busyId === row.id}
                onClick={() => checkout(row, openCheckin(row)!.id)}
                className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busyId === row.id ? "处理中…" : "签退"}
              </button>
            ) : null}
          </div>
        )}
        footer={
          actionError ? (
            <div className="border-t border-border px-4 py-3">
              <p className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{actionError}</p>
            </div>
          ) : undefined
        }
      />

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
            <label htmlFor="plan-date" className="text-ink-secondary text-sm font-medium">
              计划日期<span className="text-status-danger-text ml-0.5">*</span>
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
            创建后显示在当前周/月视图；拜访时在列表行内完成定位签到/签退。
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
