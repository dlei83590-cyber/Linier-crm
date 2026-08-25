"use client";

/**
 * UI-05 — 客户公海池详情（现代重构）
 *
 * - 三态统一：池信息/条目加载 = Skeleton；失败 = ErrorPanel + Retry（真实 ApiClientError，不伪装空态）
 * - 条目表：sticky header + hover 行 + StatusBadge（在公海/已被挑入/已移出）+ 状态筛选 chips + 分页
 * - 领取（claim）/ 移出（release）/ 手工入池只消费真实 API，且按 customer-pool:assign 权限门渲染
 * - 409 业务冲突展示后端真实提示并刷新真实状态（isPoolActionConflict）
 * - 自动匹配能力如实说明（REGION 已实现 / DEPARTMENT 未实现，不虚报）
 */
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, PageHeader, StatusBadge, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { formatDate } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { Skeleton, Spinner } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { CustomerPicker, type CustomerOption } from "@/components/customer-pool/customer-picker";
import {
  POOL_SCOPE_LABELS,
  POOL_ENTRY_STATUS_LABELS,
  POOL_ENTER_REASON_LABELS,
  PARTNER_TYPE_LABELS,
  isPoolActionConflict,
} from "@/lib/customer-pool/labels";

interface PoolDetail {
  id: string;
  code: string;
  name: string;
  description: string | null;
  scopeType: string;
  scopeValue: string | null;
  isActive: boolean;
  version: number;
  rules: { id: string; ruleType: string; matchMode: string; condition: unknown; priority: number; isActive: boolean }[];
}

interface EntryRow {
  id: string;
  status: string;
  enteredAt: string;
  enterReason: string;
  businessPartner: { id: string; code: string; name: string; type: string };
  ownerships: { ownerId: string; claimedAt: string; owner: { id: string; name: string | null; email: string | null } }[];
}

const ENTRY_STATUS_TONE: Record<string, "neutral" | "info" | "success"> = {
  IN_POOL: "info",
  CLAIMED: "success",
  RELEASED: "neutral",
};

/** 条目状态筛选 chips（真实状态枚举；全部 = 不传 status 参数） */
const ENTRY_STATUS_OPTIONS: { value: "" | "IN_POOL" | "CLAIMED" | "RELEASED"; label: string }[] = [
  { value: "", label: "全部" },
  { value: "IN_POOL", label: "在公海" },
  { value: "CLAIMED", label: "已被挑入" },
  { value: "RELEASED", label: "已移出" },
];

const ENTRY_PAGE_SIZE = 20;

function PoolDetailPage() {
  const params = useParams();
  const router = useRouter();
  const toast = useToast();
  const poolId = typeof params.id === "string" ? params.id : "";

  const [pool, setPool] = useState<PoolDetail | null>(null);
  const [poolError, setPoolError] = useState<ApiClientError | null>(null);
  const [poolLoading, setPoolLoading] = useState(true);

  // 条目（分页 + 状态筛选）
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [entriesTotal, setEntriesTotal] = useState(0);
  const [entriesPage, setEntriesPage] = useState(1);
  const [entriesStatus, setEntriesStatus] = useState<"" | "IN_POOL" | "CLAIMED" | "RELEASED">("");
  const [entriesError, setEntriesError] = useState<ApiClientError | null>(null);
  const [entriesLoading, setEntriesLoading] = useState(false);

  // 手工入池选择器
  const [selectedPartner, setSelectedPartner] = useState<CustomerOption | null>(null);
  const [addBusy, setAddBusy] = useState(false);

  // 行级动作 busy（挑入 / 释放）
  const [claimBusyId, setClaimBusyId] = useState<string | null>(null);
  const [releaseBusyId, setReleaseBusyId] = useState<string | null>(null);

  // 动作反馈（error 用 ErrorPanel 展示；success 用 Toast）
  const [actionError, setActionError] = useState<ApiClientError | null>(null);

  const loadPool = useCallback(() => {
    setPoolLoading(true);
    setPoolError(null);
    apiFetch<PoolDetail>("/api/customer-pools/" + poolId)
      .then(({ data }) => setPool(data))
      .catch((err: unknown) =>
        setPoolError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载公海池失败", "NETWORK_ERROR")),
      )
      .finally(() => setPoolLoading(false));
  }, [poolId]);

  const loadEntries = useCallback(
    (page: number, status: typeof entriesStatus) => {
      setEntriesLoading(true);
      setEntriesError(null);
      const query = new URLSearchParams({ page: String(page), pageSize: String(ENTRY_PAGE_SIZE) });
      if (status) query.set("status", status);
      apiFetch<EntryRow[]>("/api/customer-pools/" + poolId + "/entries?" + query.toString())
        .then(({ data, meta }) => {
          setEntries(Array.isArray(data) ? data : []);
          setEntriesTotal(meta?.total ?? (Array.isArray(data) ? data.length : 0));
        })
        .catch((err: unknown) =>
          setEntriesError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载池条目失败", "NETWORK_ERROR")),
        )
        .finally(() => setEntriesLoading(false));
    },
    [poolId],
  );

  useEffect(() => {
    if (poolId) loadPool();
  }, [poolId, loadPool]);

  useEffect(() => {
    if (poolId) loadEntries(entriesPage, entriesStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolId, entriesPage, entriesStatus]);

  const refreshEntries = () => loadEntries(entriesPage, entriesStatus);

  const clearActionError = () => setActionError(null);

  /** 手工入池：POST /api/customer-pools/:poolId/entries（选择器只允许 CUSTOMER/BOTH） */
  const addEntry = async () => {
    if (!selectedPartner || addBusy) return;
    setAddBusy(true);
    clearActionError();
    try {
      await apiFetch("/api/customer-pools/" + poolId + "/entries", {
        method: "POST",
        body: JSON.stringify({ businessPartnerId: selectedPartner.id }),
      });
      const msg = selectedPartner.name + "（" + selectedPartner.code + "）已进入公海";
      toast.success("手工入池成功", msg);
      setSelectedPartner(null);
      refreshEntries();
    } catch (err: unknown) {
      const e = err instanceof ApiClientError ? err : new ApiClientError(0, "手工入池失败", "NETWORK_ERROR");
      setActionError(e);
      toast.error("手工入池失败", e.message);
      if (isPoolActionConflict(e)) refreshEntries();
    } finally {
      setAddBusy(false);
    }
  };

  /** 挑入：POST claim（IN_POOL → CLAIMED） */
  const claimEntry = async (entry: EntryRow) => {
    if (claimBusyId || releaseBusyId) return;
    setClaimBusyId(entry.id);
    clearActionError();
    try {
      await apiFetch("/api/customer-pools/" + poolId + "/entries/" + entry.id + "/claim", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const msg = entry.businessPartner.name + "（" + entry.businessPartner.code + "）已挑入";
      toast.success("挑入成功", msg);
      refreshEntries();
    } catch (err: unknown) {
      const e = err instanceof ApiClientError ? err : new ApiClientError(0, "挑入失败", "NETWORK_ERROR");
      setActionError(e);
      toast.error("挑入失败", e.message);
      // 409：并发被他人挑入 / 已有归属——展示后端真实业务提示并刷新真实状态
      if (isPoolActionConflict(e)) refreshEntries();
    } finally {
      setClaimBusyId(null);
    }
  };

  /** 释放回公海：POST release（CLAIMED → IN_POOL，归属 releasedAt） */
  const releaseEntry = async (entry: EntryRow) => {
    if (claimBusyId || releaseBusyId) return;
    setReleaseBusyId(entry.id);
    clearActionError();
    try {
      await apiFetch("/api/customer-pools/" + poolId + "/entries/" + entry.id + "/release", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const msg = entry.businessPartner.name + "（" + entry.businessPartner.code + "）已释放回公海";
      toast.success("释放成功", msg);
      refreshEntries();
    } catch (err: unknown) {
      const e = err instanceof ApiClientError ? err : new ApiClientError(0, "释放失败", "NETWORK_ERROR");
      setActionError(e);
      toast.error("释放失败", e.message);
      if (isPoolActionConflict(e)) refreshEntries();
    } finally {
      setReleaseBusyId(null);
    }
  };

  const anyActionBusy = addBusy || claimBusyId !== null || releaseBusyId !== null;

  const scopeLabel = pool ? POOL_SCOPE_LABELS[pool.scopeType] ?? pool.scopeType : "";
  const scopeValueLabel = pool?.scopeValue ? "：" + pool.scopeValue : "";

  return (
    <AppPage>
      <PageHeader
        title={pool ? pool.name : "公海池详情"}
        description={pool ? pool.code + " · " + scopeLabel + scopeValueLabel : "加载中…"}
        backHref="/customer-pools"
        backLabel="返回公海列表"
        actions={
          pool ? (
            <StatusBadge
              status={pool.isActive ? "ACTIVE" : "INACTIVE"}
              label={pool.isActive ? "启用" : "停用"}
              tone={pool.isActive ? "success" : "neutral"}
            />
          ) : undefined
        }
      />

      <div className="space-y-4">
        {/* 自动匹配能力说明（FRT-03 #8：不虚报） */}
        <div className="flex items-start gap-2.5 rounded-md border border-status-info-border bg-status-info-bg p-3 text-sm text-status-info-text">
          <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p>
            自动匹配说明：当前版本仅支持 <strong>REGION（客户区域 = 公海区域字符串）自动入池</strong>，
            命中后条目标记为「规则自动」；DEPARTMENT 公海暂未实现自动入池（仅支持手工入池）；
            GLOBAL 公海不自动入池。手工入池适用于全部类型公海。
          </p>
        </div>

        {/* 池信息加载失败（与条目失败分离，互不吞错） */}
        {poolError && !pool ? (
          <ErrorPanel error={poolError} title="加载公海池失败" onRetry={loadPool} />
        ) : null}
        {poolLoading && !pool && !poolError ? (
          <div className="rounded-lg border border-border bg-surface p-4 shadow-elevation-sm">
            <div className="space-y-3">
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        ) : null}

        {/* 动作失败反馈（ErrorPanel：真实错误，不伪装空态） */}
        {actionError ? <ErrorPanel error={actionError} title="操作未完成" /> : null}

        {/* 条目区 */}
        <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-elevation-sm">
          <div className="border-b border-border px-4 py-3 md:px-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-ink-primary">池条目</h2>
              <span className="text-sm tabular-nums text-ink-muted">共 {entriesTotal} 条</span>
            </div>
            {/* 状态筛选 chips（真实状态枚举，点击即刷新服务端筛选） */}
            <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="按条目状态筛选">
              {ENTRY_STATUS_OPTIONS.map((opt) => {
                const active = entriesStatus === opt.value;
                return (
                  <button
                    key={opt.value || "all"}
                    type="button"
                    onClick={() => {
                      setEntriesStatus(opt.value);
                      setEntriesPage(1);
                    }}
                    className={
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
                      (active
                        ? "border-brand-300 bg-brand-50 text-brand-700"
                        : "border-border bg-surface text-ink-secondary hover:border-brand-200 hover:bg-canvas")
                    }
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {entriesLoading ? (
            <div className="space-y-3 p-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-1/4" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          ) : entriesError ? (
            <div className="p-4">
              <ErrorPanel error={entriesError} title="加载池条目失败" onRetry={refreshEntries} />
            </div>
          ) : entries.length === 0 ? (
            <EmptyState
              title={entriesStatus ? "暂无「" + (POOL_ENTRY_STATUS_LABELS[entriesStatus] ?? entriesStatus) + "」状态的条目" : "暂无条目"}
              description={
                entriesStatus
                  ? "切换其他状态筛选查看，或手工入池新的客户"
                  : "点击下方「手工入池」添加客户，或等待 REGION 自动匹配规则命中"
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="sticky top-0 z-10 bg-canvas text-left text-xs font-semibold text-ink-secondary">
                  <tr>
                    <th scope="col" className="px-4 py-3">客户</th>
                    <th scope="col" className="px-4 py-3">状态</th>
                    <th scope="col" className="px-4 py-3">入池时间 / 方式</th>
                    <th scope="col" className="px-4 py-3">当前负责人</th>
                    <th scope="col" className="px-4 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {entries.map((e) => {
                    const busy = claimBusyId === e.id || releaseBusyId === e.id;
                    return (
                      <tr key={e.id} className="group transition-colors hover:bg-brand-50/40">
                        <td className="whitespace-nowrap px-4 py-3">
                          <button
                            className="font-medium text-brand-600 hover:underline"
                            onClick={() => router.push("/business-partners/" + e.businessPartner.id)}
                          >
                            {e.businessPartner.name}
                          </button>
                          <span className="ml-1 text-xs text-ink-muted">
                            （{e.businessPartner.code} · {PARTNER_TYPE_LABELS[e.businessPartner.type] ?? e.businessPartner.type}）
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <StatusBadge
                            status={e.status}
                            label={POOL_ENTRY_STATUS_LABELS[e.status] ?? e.status}
                            tone={ENTRY_STATUS_TONE[e.status] ?? "neutral"}
                          />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-secondary">
                          <span className="tabular-nums">{formatDate(e.enteredAt)}</span>
                          <span className="text-ink-muted"> · </span>
                          {e.enterReason === "FIELD_RULE" ? (
                            <StatusBadge status="FIELD_RULE" label="规则自动" tone="warning" hideDot />
                          ) : (
                            <span>{POOL_ENTER_REASON_LABELS[e.enterReason] ?? e.enterReason}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-secondary">
                          {e.ownerships[0]?.owner.name ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            {e.status === "IN_POOL" ? (
                              <PermissionGuard permission={actionPermission("customer-pool", "assign")}>
                                <button
                                  onClick={() => claimEntry(e)}
                                  disabled={busy || anyActionBusy}
                                  className={BUTTON_SECONDARY_CLASS + " !py-1 text-xs"}
                                >
                                  {claimBusyId === e.id ? (
                                    <span className="inline-flex items-center gap-1">
                                      <Spinner /> 挑入中…
                                    </span>
                                  ) : (
                                    "挑入"
                                  )}
                                </button>
                              </PermissionGuard>
                            ) : e.status === "CLAIMED" ? (
                              <PermissionGuard permission={actionPermission("customer-pool", "assign")}>
                                <button
                                  onClick={() => releaseEntry(e)}
                                  disabled={busy || anyActionBusy}
                                  className={BUTTON_SECONDARY_CLASS + " !py-1 text-xs"}
                                >
                                  {releaseBusyId === e.id ? (
                                    <span className="inline-flex items-center gap-1">
                                      <Spinner /> 释放中…
                                    </span>
                                  ) : (
                                    "释放回公海"
                                  )}
                                </button>
                              </PermissionGuard>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!entriesLoading && !entriesError && entriesTotal > ENTRY_PAGE_SIZE ? (
            <Pagination
              page={entriesPage}
              pageSize={ENTRY_PAGE_SIZE}
              total={entriesTotal}
              onPageChange={setEntriesPage}
            />
          ) : null}

          {/* 手工入池（客户选择器，仅 CUSTOMER/BOTH；禁手打 ID） */}
          <div className="border-t border-border bg-canvas/50 px-4 py-4 md:px-6">
            <PermissionGuard permission={actionPermission("customer-pool", "assign")}>
              <h3 className="mb-2 text-sm font-semibold text-ink-primary">手工入池</h3>
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-72 flex-1">
                  <CustomerPicker value={selectedPartner} onChange={setSelectedPartner} disabled={addBusy} />
                </div>
                <button
                  onClick={addEntry}
                  disabled={addBusy || !selectedPartner}
                  className={BUTTON_PRIMARY_CLASS}
                >
                  {addBusy ? (
                    <span className="inline-flex items-center gap-1">
                      <Spinner /> 入池中…
                    </span>
                  ) : (
                    "手工入池"
                  )}
                </button>
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                搜索并选择客户（仅 CUSTOMER / BOTH 类型）后入池；客户区域与公海 scope 不符、已有归属或已在池中时会返回具体业务提示。
              </p>
            </PermissionGuard>
          </div>
        </section>
      </div>
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("customer-pool", "view")}>
      <PoolDetailPage />
    </PermissionGuard>
  );
}
