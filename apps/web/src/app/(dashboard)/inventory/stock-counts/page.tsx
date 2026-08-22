"use client";

/**
 * Stock Counts — 库存盘点列表页（F2-3 Batch C2 Consolidation，CTO #11888）
 *
 * 由旧式自绘 table/filter 迁移至统一 Workspace：
 * AppPage → EntityListWorkspace → StatusBadge / ErrorPanel / common toolbar。
 * 不改 backend / 状态机 / action；useListQuery + filters 原样保留。
 */
import { useState } from "react";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { hasPermission, actionPermission, PERMISSIONS, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { AppPage, EntityListWorkspace, StatusBadge, ConfirmActionDialog } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";

interface StockCountRow {
  id: string;
  countNo: string;
  status: string;
  completedAt?: string | null;
  countedBy?: { name: string | null } | null;
  _count?: { lines: number };
}

const STATUS_OPTIONS = ["DRAFT", "COUNTING", "COMPLETED", "ADJUSTED", "CANCELLED"] as const;

/** 状态中文业务名（Business UX Rationalization：枚举展示中文，不展示数据库枚举值；key 保留真实 enum） */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  COUNTING: "盘点中",
  COMPLETED: "已完成",
  ADJUSTED: "已调整",
  CANCELLED: "已取消",
};

function StockCountList() {
  const { state } = useSession();
  const toast = useToast();
  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("stock-count", "create"));
  const canDelete = hasPermission(roles, actionPermission("stock-count", "delete"));
  const [countNoInput, setCountNoInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ countNo?: string; status?: string }>({});
  const [deleting, setDeleting] = useState<StockCountRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<StockCountRow>("/api/stock-counts", filters);

  const applyFilter = () => {
    const next: { countNo?: string; status?: string } = {};
    if (countNoInput.trim()) next.countNo = countNoInput.trim();
    if (statusInput) next.status = statusInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setCountNoInput("");
    setStatusInput("");
    setFilters({});
    setPage(1);
  };

  const runDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await apiFetch("/api/stock-counts/" + deleting.id, { method: "DELETE" });
      toast.success("盘点单已删除");
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
      <EntityListWorkspace<StockCountRow>
        title="库存盘点"
        description="库存盘点工作台"
        emptyMessage="暂无盘点单——点击「+ 新建」创建第一张"
        headerActions={
          canCreate ? (
            <Link
              href="/inventory/stock-counts/new"
              className={BUTTON_PRIMARY_CLASS}
            >
              + 新建盘点单
            </Link>
          ) : undefined
        }
        filters={
          <>
            <input
              value={countNoInput}
              onChange={(e) => setCountNoInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按盘点单号搜索"
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
            key: "countNo",
            header: "盘点单号",
            render: (row) => (
              <Link
                href={`/inventory/stock-counts/${row.id}`}
                className="font-medium text-brand-600 hover:underline"
              >
                {row.countNo}
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
            key: "countedBy",
            header: "盘点人",
            render: (row) => row.countedBy?.name ?? "—",
          },
          {
            key: "lines",
            header: "行数",
            render: (row) => String(row._count?.lines ?? 0),
          },
          {
            key: "completedAt",
            header: "完成日期",
            render: (row) => formatDate(row.completedAt),
          },
          {
            key: "actions",
            header: "操作",
            render: (row) => (
              <div className="flex items-center gap-2">
                {["DRAFT", "CANCELLED"].includes(row.status) && canDelete && (
                  <button
                    type="button"
                    onClick={() => setDeleting(row)}
                    disabled={deleteBusy}
                    className="rounded-md border border-status-danger-border px-2 py-1 text-xs text-status-danger-text hover:bg-status-danger-bg/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    删除
                  </button>
                )}
              </div>
            ),
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
      />

      <ConfirmActionDialog
        open={deleting !== null}
        title={"删除盘点单「" + (deleting?.countNo ?? "") + "」？"}
        description="仅草稿/已取消状态的盘点单可删除；删除后列表不再展示。"
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
    <PermissionGuard permission={PERMISSIONS.STOCK_COUNT_READ}>
      <StockCountList />
    </PermissionGuard>
  );
}