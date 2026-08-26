"use client";

/**
 * Inventory Transfers — 库存调拨列表页（F2-3 Batch C2 Consolidation，CTO #11888）
 *
 * 由旧式自绘 table/filter 迁移至统一 Workspace：
 * AppPage → EntityListWorkspace → StatusBadge / ErrorPanel / common toolbar。
 * 不改 backend / 状态机 / action；useListQuery + filters 原样保留。
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { AppPage, EntityListWorkspace, StatusBadge, ConfirmActionDialog, ModuleKpiStrip } from "@/components/workspace";
import type { ModuleSummaryData } from "@/lib/module-summary/types";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery, readUrlFilterParams } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";

interface TransferRow {
  id: string;
  transferNo: string;
  status: string;
  executedAt?: string | null;
  sourceWarehouse?: { name: string | null } | null;
  destinationWarehouse?: { name: string | null } | null;
  _count?: { lines: number };
}

const STATUS_OPTIONS = ["DRAFT", "SUBMITTED", "APPROVED", "EXECUTED", "CANCELLED"] as const;

/** 状态中文业务名（Business UX Rationalization：枚举展示中文，不展示数据库枚举值；key 保留真实 enum） */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "已提交",
  APPROVED: "已批准",
  EXECUTED: "已执行",
  CANCELLED: "已取消",
};

function TransferList() {
  const { state } = useSession();
  const toast = useToast();
  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("inventory-transfer", "create"));
  const canDelete = hasPermission(roles, actionPermission("inventory-transfer", "delete"));
  const [noInput, setNoInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ transferNo?: string; status?: string }>({});
  const [deleting, setDeleting] = useState<TransferRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [summary, setSummary] = useState<ModuleSummaryData | null>(null);

  // 页面仪表盘 KPI：只读汇总（GET /api/inventory-transfers/summary）；失败静默隐藏
  useEffect(() => {
    let cancelled = false;
    apiFetch<ModuleSummaryData>("/api/inventory-transfers/summary")
      .then((b) => {
        if (!cancelled) setSummary(b.data);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 仪表盘卡片点击：联动列表状态筛选（保留其他筛选）
  const selectStatus = (status: string | null) => {
    setStatusInput(status ?? "");
    setFilters((prev) => {
      const next = { ...prev };
      if (status) next.status = status;
      else delete next.status;
      return next;
    });
    setPage(1);
  };

  const { items, total, page, pageSize, loading, error, setPage, setPageSize, refresh } =
    useListQuery<TransferRow>("/api/inventory-transfers", filters, 20, { syncUrl: true });
  // URL 筛选恢复（hydration 后一次性应用；刷新/分享后筛选不丢失）
  const urlRestored = useRef(false);
  useEffect(() => {
    if (urlRestored.current) return;
    urlRestored.current = true;
    const u = readUrlFilterParams(["transferNo", "status"]);
    setNoInput(u.transferNo ?? "");
    setStatusInput(u.status ?? "");
    setFilters(() => {
      const n: { transferNo?: string; status?: string } = {};
      if (u.transferNo) n.transferNo = u.transferNo;
      if (u.status) n.status = u.status;
      return n;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilter = () => {
    const next: { transferNo?: string; status?: string } = {};
    if (noInput.trim()) next.transferNo = noInput.trim();
    if (statusInput) next.status = statusInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setNoInput("");
    setStatusInput("");
    setFilters({});
    setPage(1);
  };

  const runDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await apiFetch("/api/inventory-transfers/" + deleting.id, { method: "DELETE" });
      toast.success("调拨单已删除");
      setDeleting(null);
      refresh();
    } catch (err) {
      const e = err instanceof ApiClientError ? err : new ApiClientError(0, "删除失败", "NETWORK_ERROR");
      toast.error("删除失败", e.message);
      setDeleting(null);
      refresh();
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <AppPage>
      <ModuleKpiStrip
        statuses={STATUS_OPTIONS.map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s }))}
        data={summary}
        activeStatus={filters.status ?? null}
        onSelectStatus={selectStatus}
      />
      <EntityListWorkspace<TransferRow>
        title="库存调拨"
        description="库存调拨仪表盘"
        emptyMessage="暂无调拨单——点击「+ 新建」创建第一张"
        headerActions={
          canCreate ? (
            <Link
              href="/inventory/transfers/new"
              className={BUTTON_PRIMARY_CLASS}
            >
              + 新建调拨
            </Link>
          ) : undefined
        }
        filters={
          <>
            <input
              value={noInput}
              onChange={(e) => setNoInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按调拨单号搜索"
              className={"w-40 " + SELECT_CLASS}
            />
            <select
              value={statusInput}
              onChange={(e) => setStatusInput(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">全部状态</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s] ?? s}
                </option>
              ))}
            </select>
          </>
        }
        toolbarActions={
          <>
            <button
              type="button"
              onClick={applyFilter}
              className={BUTTON_PRIMARY_CLASS}
            >
              查询
            </button>
            <button
              type="button"
              onClick={resetFilter}
              className={BUTTON_SECONDARY_CLASS}
            >
              重置
            </button>
          </>
        }
        columns={[
          {
            key: "transferNo",
            header: "调拨单号",
            render: (row) => (
              <Link
                href={`/inventory/transfers/${row.id}`}
                className="font-medium text-brand-600 hover:underline"
              >
                {row.transferNo}
              </Link>
            ),
          },
          {
            key: "status",
            header: "状态",
            render: (row) => (
              <StatusBadge status={row.status} label={STATUS_LABELS[row.status] ?? row.status} />
            ),
          },
          {
            key: "sourceWarehouse",
            header: "源仓库",
            render: (row) => row.sourceWarehouse?.name ?? "—",
          },
          {
            key: "destinationWarehouse",
            header: "目标仓库",
            render: (row) => row.destinationWarehouse?.name ?? "—",
          },
          {
            key: "lines",
            header: "行数",
            align: "right",
            render: (row) => String(row._count?.lines ?? 0),
          },
          {
            key: "executedAt",
            header: "执行日期",
            render: (row) => formatDate(row.executedAt),
          },
        ]}
        rows={items}
        rowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={refresh}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        activeFilters={[
          filters.transferNo
            ? {
                key: "transferNo",
                label: `调拨单号：${filters.transferNo}`,
                onClear: () => {
                  setNoInput("");
                  setFilters((prev) => {
                    const n = { ...prev };
                    delete n.transferNo;
                    return n;
                  });
                },
              }
            : null,
          filters.status
            ? {
                key: "status",
                label: `状态：${STATUS_LABELS[filters.status] ?? filters.status}`,
                onClear: () => {
                  setStatusInput("");
                  setFilters((prev) => {
                    const n = { ...prev };
                    delete n.status;
                    return n;
                  });
                },
              }
            : null,
        ].filter((c): c is NonNullable<typeof c> => c !== null)}
        rowActions={
          canDelete
            ? (row) =>
                ["DRAFT", "CANCELLED"].includes(row.status) ? (
                  <button
                    type="button"
                    onClick={() => setDeleting(row)}
                    disabled={deleteBusy}
                    className="rounded-md border border-status-danger-border px-2 py-1 text-xs text-status-danger-text hover:bg-status-danger-bg/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    删除
                  </button>
                ) : null
            : undefined
        }
      />

      <ConfirmActionDialog
        open={deleting !== null}
        title={"删除调拨单「" + (deleting?.transferNo ?? "") + "」？"}
        description="仅草稿/已取消状态的调拨单可删除；删除后列表不再展示。"
        confirmLabel="确认删除"
        tone="danger"
        busy={deleteBusy}
        onConfirm={runDelete}
        onCancel={() => setDeleting(null)}
      />
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.INVENTORY_TRANSFER_READ}>
      <TransferList />
    </PermissionGuard>
  );
}