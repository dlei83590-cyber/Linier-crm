"use client";

/**
 * FRT-03 — Customer Pool 详情（生产测试 UX 收口）
 *
 * - 手工入池：客户搜索选择器（code+name+region，仅 CUSTOMER/BOTH），禁手打 BP ID；
 * - IN_POOL → 挑入（POST claim）；CLAIMED → 释放回公海（POST release）；
 * - 每个 action 独立 busy / success / error；409 业务冲突展示后端真实业务提示并刷新；
 * - FIELD_RULE（规则自动）条目明确标注「规则自动」；
 * - 页面明确：自动匹配 = REGION（区域字符串 EQ）；DEPARTMENT 自动匹配未实现，不虚报；
 * - 空数据与接口失败区分（条目加载失败显示错误 + 重试，不再吞错误）。
 */
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, PageHeader } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { formatDate } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/skeleton";
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

function PoolDetailPage() {
  const params = useParams();
  const router = useRouter();
  const toast = useToast();
  const poolId = typeof params.id === "string" ? params.id : "";

  const [pool, setPool] = useState<PoolDetail | null>(null);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [poolError, setPoolError] = useState<ApiClientError | null>(null);
  const [entriesError, setEntriesError] = useState<ApiClientError | null>(null);
  const [poolLoading, setPoolLoading] = useState(true);
  const [entriesLoading, setEntriesLoading] = useState(false);

  // 手工入池选择器
  const [selectedPartner, setSelectedPartner] = useState<CustomerOption | null>(null);
  const [addBusy, setAddBusy] = useState(false);

  // 行级动作 busy（挑入 / 释放）
  const [claimBusyId, setClaimBusyId] = useState<string | null>(null);
  const [releaseBusyId, setReleaseBusyId] = useState<string | null>(null);

  // 动作反馈（success / error 二选一，操作前清空）
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

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

  const loadEntries = useCallback(() => {
    setEntriesLoading(true);
    setEntriesError(null);
    apiFetch<EntryRow[]>("/api/customer-pools/" + poolId + "/entries?page=1&pageSize=50")
      .then(({ data }) => setEntries(data))
      .catch((err: unknown) =>
        setEntriesError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载池条目失败", "NETWORK_ERROR")),
      )
      .finally(() => setEntriesLoading(false));
  }, [poolId]);

  const load = useCallback(() => {
    loadPool();
    loadEntries();
  }, [loadPool, loadEntries]);

  useEffect(() => {
    if (poolId) load();
  }, [poolId, load]);

  const clearActionFeedback = () => {
    setActionError(null);
    setActionSuccess(null);
  };

  /** 手工入池：POST /api/customer-pools/:poolId/entries（选择器只允许 CUSTOMER/BOTH） */
  const addEntry = async () => {
    if (!selectedPartner || addBusy) return;
    setAddBusy(true);
    clearActionFeedback();
    try {
      await apiFetch("/api/customer-pools/" + poolId + "/entries", {
        method: "POST",
        body: JSON.stringify({ businessPartnerId: selectedPartner.id }),
      });
      const msg = `${selectedPartner.name}（${selectedPartner.code}）已进入公海`;
      setActionSuccess(msg);
      toast.success("手工入池成功", msg);
      setSelectedPartner(null);
      loadEntries();
    } catch (err: unknown) {
      const e = err instanceof ApiClientError ? err : new ApiClientError(0, "手工入池失败", "NETWORK_ERROR");
      setActionError(e.message);
      toast.error("手工入池失败", e.message);
      if (isPoolActionConflict(e)) loadEntries();
    } finally {
      setAddBusy(false);
    }
  };

  /** 挑入：POST claim（IN_POOL → CLAIMED） */
  const claimEntry = async (entry: EntryRow) => {
    if (claimBusyId || releaseBusyId) return;
    setClaimBusyId(entry.id);
    clearActionFeedback();
    try {
      await apiFetch("/api/customer-pools/" + poolId + "/entries/" + entry.id + "/claim", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const msg = `${entry.businessPartner.name}（${entry.businessPartner.code}）已挑入`;
      setActionSuccess(msg);
      toast.success("挑入成功", msg);
      loadEntries();
    } catch (err: unknown) {
      const e = err instanceof ApiClientError ? err : new ApiClientError(0, "挑入失败", "NETWORK_ERROR");
      setActionError(e.message);
      toast.error("挑入失败", e.message);
      // 409：并发被他人挑入 / 已有归属——展示真实业务提示并刷新真实状态
      if (isPoolActionConflict(e)) loadEntries();
    } finally {
      setClaimBusyId(null);
    }
  };

  /** 释放回公海：POST release（CLAIMED → IN_POOL，归属 releasedAt） */
  const releaseEntry = async (entry: EntryRow) => {
    if (claimBusyId || releaseBusyId) return;
    setReleaseBusyId(entry.id);
    clearActionFeedback();
    try {
      await apiFetch("/api/customer-pools/" + poolId + "/entries/" + entry.id + "/release", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const msg = `${entry.businessPartner.name}（${entry.businessPartner.code}）已释放回公海`;
      setActionSuccess(msg);
      toast.success("释放成功", msg);
      loadEntries();
    } catch (err: unknown) {
      const e = err instanceof ApiClientError ? err : new ApiClientError(0, "释放失败", "NETWORK_ERROR");
      setActionError(e.message);
      toast.error("释放失败", e.message);
      if (isPoolActionConflict(e)) loadEntries();
    } finally {
      setReleaseBusyId(null);
    }
  };

  const anyActionBusy = addBusy || claimBusyId !== null || releaseBusyId !== null;

  return (
    <AppPage>
      <PageHeader
        title={pool ? pool.name : "公海池详情"}
        description={
          pool
            ? pool.code +
              " · " +
              (POOL_SCOPE_LABELS[pool.scopeType] ?? pool.scopeType) +
              (pool.scopeValue ? "：" + pool.scopeValue : "")
            : "加载中…"
        }
        backHref="/customer-pools"
        backLabel="返回公海列表"
      />

      <div className="space-y-4">
        {/* 自动匹配能力说明（FRT-03 #8：不虚报） */}
        <div className="rounded-md border border-status-info-border bg-status-info-bg p-3 text-sm text-status-info-text">
          自动匹配说明：当前版本仅支持 <strong>REGION（客户区域 = 公海区域字符串）自动入池</strong>，
          命中后条目标记为「规则自动」；DEPARTMENT 公海暂未实现自动入池（仅支持手工入池）；
          GLOBAL 公海不自动入池。手工入池适用于全部类型公海。
        </div>

        {poolError && !pool ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            加载公海池失败：{poolError.message}
            <button onClick={loadPool} className="mt-2 block text-brand-600 hover:underline">
              重试
            </button>
          </div>
        ) : null}
        {poolLoading && !pool && !poolError ? (
          <p className="text-sm text-ink-muted">公海池加载中…</p>
        ) : null}

        {actionError ? (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {actionError}
          </p>
        ) : null}
        {actionSuccess ? (
          <p role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
            {actionSuccess}
          </p>
        ) : null}

        {/* 条目区 */}
        <section className="rounded-md border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink-primary">池条目</h2>

          {entriesLoading && !entriesError ? (
            <p className="text-sm text-ink-muted">条目加载中…</p>
          ) : entriesError ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              加载池条目失败：{entriesError.message}
              <button onClick={loadEntries} className="ml-2 text-brand-600 hover:underline">
                重试
              </button>
            </div>
          ) : (
            <>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-ink-muted">
                    <th className="px-2 py-2">客户</th>
                    <th className="px-2 py-2">状态</th>
                    <th className="px-2 py-2">入池时间/方式</th>
                    <th className="px-2 py-2">当前负责人</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {entries.map((e) => {
                    const busy = claimBusyId === e.id || releaseBusyId === e.id;
                    return (
                      <tr key={e.id}>
                        <td className="px-2 py-2">
                          <button
                            className="text-brand-600 hover:underline"
                            onClick={() => router.push("/business-partners/" + e.businessPartner.id)}
                          >
                            {e.businessPartner.name}
                          </button>
                          <span className="ml-1 text-xs text-ink-muted">
                            （{e.businessPartner.code} · {PARTNER_TYPE_LABELS[e.businessPartner.type] ?? e.businessPartner.type}）
                          </span>
                        </td>
                        <td className="px-2 py-2">{POOL_ENTRY_STATUS_LABELS[e.status] ?? e.status}</td>
                        <td className="px-2 py-2 text-xs text-ink-muted">
                          {formatDate(e.enteredAt)} ·{" "}
                          {e.enterReason === "FIELD_RULE" ? (
                            <span
                              className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700"
                              title="由 REGION 自动匹配规则自动入池（客户区域匹配公海区域）"
                            >
                              规则自动
                            </span>
                          ) : (
                            (POOL_ENTER_REASON_LABELS[e.enterReason] ?? e.enterReason)
                          )}
                        </td>
                        <td className="px-2 py-2 text-xs">{e.ownerships[0]?.owner.name ?? "—"}</td>
                        <td className="px-2 py-2 text-right">
                          {e.status === "IN_POOL" ? (
                            <PermissionGuard permission={actionPermission("customer-pool", "assign")}>
                              <button
                                onClick={() => claimEntry(e)}
                                disabled={busy || anyActionBusy}
                                className={BUTTON_SECONDARY_CLASS + " text-xs"}
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
                                className={BUTTON_SECONDARY_CLASS + " text-xs"}
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
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {entries.length === 0 && <p className="mt-2 text-sm text-ink-muted">暂无条目。</p>}
            </>
          )}

          {/* 手工入池（客户选择器，仅 CUSTOMER/BOTH；禁手打 ID） */}
          <PermissionGuard permission={actionPermission("customer-pool", "assign")}>
            <div className="mt-4 border-t border-border pt-4">
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
            </div>
          </PermissionGuard>
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
