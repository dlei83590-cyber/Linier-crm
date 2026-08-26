"use client";

/**
 * Phase 2C-2 — Customer 360 公海状态卡（FE 2.0：三态统一）
 *
 * 显示：当前客户 Ownership（SSOT）/ 当前 Pool 状态 / 所属 Pool / enteredAt·reason / 当前 owner /
 *      claim / release。
 * 数据源：GET /api/business-partners/:id/pool-status（customer-pool:view）。
 * 操作：claim / release（customer-pool:assign）。
 * 三态：loading 骨架 / error 图标+重试 / empty 图标+说明；权限不足不渲染按钮。
 */
import { useCallback, useEffect, useState } from "react";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { formatDate } from "@/lib/format";
import { IconAlertCircle, IconRefreshCw } from "./icons";

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
}

const STATUS_LABELS: Record<string, string> = { IN_POOL: "在公海", CLAIMED: "已被挑入" };
const ENTER_REASON_LABELS: Record<string, string> = { MANUAL: "手工入池", FIELD_RULE: "规则自动", RE_ENTER: "重新入池" };

export function PoolStatusCard({ partnerId }: { partnerId: string }) {
  const [data, setData] = useState<PoolStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
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
    <section className="rounded-xl border border-border bg-surface p-5 shadow-elevation-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-primary">客户公海</h2>
        {data?.entry ? (
          <StatusBadge
            status={data.entry.status}
            label={STATUS_LABELS[data.entry.status] ?? data.entry.status}
            toneMap={{ IN_POOL: "warning", CLAIMED: "success" }}
          />
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-status-danger-border bg-status-danger-bg/30 py-8 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-status-danger-bg text-status-danger-text">
            <IconAlertCircle className="h-5 w-5" />
          </span>
          <p className="text-sm text-status-danger-text">{error}</p>
          <button type="button" onClick={load} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-hover">
            <IconRefreshCw className="h-3.5 w-3.5" />
            重试
          </button>
        </div>
      ) : !data || !data.entry ? (
        <EmptyState
          title="不在公海中"
          description="客户当前有归属或未进入任何公海池；挑入/释放操作见对应公海工作台。"
        />
      ) : (
        <div className="space-y-3.5 text-sm">
          {/* 池状态 + 当前 owner */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-medium text-ink-primary">{data.entry.pool.name}</span>
            <span className="text-xs text-ink-secondary">
              {formatDate(data.entry.enteredAt)} · {ENTER_REASON_LABELS[data.entry.enterReason] ?? data.entry.enterReason}
            </span>
            <span className="text-xs text-ink-secondary">
              {data.activeOwnership ? "当前负责人：" + (data.activeOwnership.owner.name ?? data.activeOwnership.owner.email) : "当前无归属"}
            </span>
          </div>

          {/* claim / release 操作（权限门：不渲染假按钮） */}
          <PermissionGuard permission={actionPermission("customer-pool", "assign")}>
            <div className="flex gap-2">
              {data.entry.status === "IN_POOL" && (
                <button
                  onClick={claim}
                  disabled={acting}
                  className={BUTTON_PRIMARY_CLASS + " text-xs"}
                >
                  {acting ? "处理中…" : "挑入（claim）"}
                </button>
              )}
              {data.entry.status === "CLAIMED" && data.activeOwnership && (
                <button
                  onClick={release}
                  disabled={acting}
                  className={BUTTON_SECONDARY_CLASS + " text-xs"}
                >
                  {acting ? "处理中…" : "释放回池"}
                </button>
              )}
            </div>
          </PermissionGuard>
        </div>
      )}
    </section>
  );
}
