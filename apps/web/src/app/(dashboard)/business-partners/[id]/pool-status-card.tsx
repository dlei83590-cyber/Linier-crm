"use client";

/**
 * Phase 2C-2 — Customer 360 公海状态卡（替代 Coming-by-contract 占位）
 *
 * 显示：当前客户 Ownership（SSOT）/ 当前 Pool 状态 / 所属 Pool / enteredAt·reason / 当前 owner /
 *      claim / release / ownership history。
 * 数据源：GET /api/business-partners/:id/pool-status（customer-pool:view）。
 * 操作：claim / release（customer-pool:assign）。
 */
import { useCallback, useEffect, useState } from "react";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";

interface PoolStatus {
  entry: {
    id: string;
    status: "IN_POOL" | "CLAIMED";
    enteredAt: string;
    enterReason: "MANUAL" | "FIELD_RULE" | "RE_ENTER";
    pool: { id: string; code: string; name: string; scopeType: string; scopeValue: string | null };
  } | null;
  activeOwnership: {
    id: string;
    claimedAt: string;
    owner: { id: string; name: string | null; email: string | null };
  } | null;
  ownershipHistory: {
    id: string;
    claimedAt: string;
    releasedAt: string | null;
    releaseReason: string | null;
    owner: { id: string; name: string | null };
    entry: { poolId: string; pool: { code: string; name: string } };
  }[];
}

const STATUS_LABELS: Record<string, string> = { IN_POOL: "在公海", CLAIMED: "已被挑入" };
const ENTER_REASON_LABELS: Record<string, string> = { MANUAL: "手工入池", FIELD_RULE: "规则自动入池", RE_ENTER: "重新入池" };
const RELEASE_REASON_LABELS: Record<string, string> = {
  RECLAIMED: "重新挑入",
  RULE_RETURN: "规则回流",
  MANUAL_RELEASE: "手动释放",
  BP_INACTIVE: "客户停用",
};

export function PoolStatusCard({ partnerId }: { partnerId: string }) {
  const [data, setData] = useState<PoolStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<PoolStatus>("/api/business-partners/" + partnerId + "/pool-status")
      .then(({ data }) => setData(data))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err.message : "加载公海状态失败");
      })
      .finally(() => setLoading(false));
  }, [partnerId]);

  useEffect(() => {
    load();
  }, [load]);

  const claim = async () => {
    if (!data?.entry || data.entry.status !== "IN_POOL") return;
    setActing(true);
    try {
      await apiFetch("/api/customer-pools/" + data.entry.pool.id + "/entries/" + data.entry.id + "/claim", {
        method: "POST",
        body: JSON.stringify({}),
      });
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : "挑入失败");
    } finally {
      setActing(false);
    }
  };

  const release = async () => {
    if (!data?.entry) return;
    setActing(true);
    try {
      await apiFetch("/api/customer-pools/" + data.entry.pool.id + "/entries/" + data.entry.id + "/release", {
        method: "POST",
        body: JSON.stringify({ mode: "TO_POOL" }),
      });
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : "释放失败");
    } finally {
      setActing(false);
    }
  };

  return (
    <section className="rounded-md border border-border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-primary">客户公海</h2>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
      {loading ? (
        <p className="text-sm text-ink-muted">加载中…</p>
      ) : !data ? (
        <p className="text-sm text-ink-muted">暂无数据。</p>
      ) : (
        <div className="space-y-3 text-sm">
          {/* 池状态 + 当前 owner */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {data.entry ? (
              <>
                <span className="font-medium">{data.entry.pool.name}</span>
                <span className="rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700">
                  {STATUS_LABELS[data.entry.status] ?? data.entry.status}
                </span>
                <span className="text-xs text-ink-muted">
                  {formatDate(data.entry.enteredAt)} · {ENTER_REASON_LABELS[data.entry.enterReason] ?? data.entry.enterReason}
                </span>
              </>
            ) : (
              <span className="text-ink-muted">不在公海中</span>
            )}
            <span className="text-xs text-ink-muted">
              {data.activeOwnership ? "当前负责人：" + (data.activeOwnership.owner.name ?? data.activeOwnership.owner.email) : "当前无归属"}
            </span>
          </div>

          {/* claim / release 操作 */}
          {data.entry && (
            <PermissionGuard permission={actionPermission("customer-pool", "assign")}>
              <div className="flex gap-2">
                {data.entry.status === "IN_POOL" && (
                  <button
                    onClick={claim}
                    disabled={acting}
                    className="rounded-md bg-brand-600 px-3 py-1.5 text-xs text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    挑入（claim）
                  </button>
                )}
                {data.entry.status === "CLAIMED" && data.activeOwnership && (
                  <button
                    onClick={release}
                    disabled={acting}
                    className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-surface-hover disabled:opacity-50"
                  >
                    释放回池
                  </button>
                )}
              </div>
            </PermissionGuard>
          )}

          {/* ownership history */}
          {data.ownershipHistory.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-medium text-ink-muted">归属历史</h3>
              <ul className="space-y-1 text-xs text-ink-muted">
                {data.ownershipHistory.map((h) => (
                  <li key={h.id}>
                    {formatDate(h.claimedAt)} 由 {h.owner.name ?? "—"} 认领（{h.entry.pool.name}）
                    {h.releasedAt && (
                      <span>
                        {" "}→ {formatDate(h.releasedAt)} 释放（{RELEASE_REASON_LABELS[h.releaseReason ?? ""] ?? h.releaseReason ?? "—"}）
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
