"use client";

/**
 * Warehouse Receipts — 仓库收货列表页（F2-3 Batch C1 Consolidation，CTO #11888）
 *
 * 由旧式自绘 table/filter 迁移至统一 Workspace：
 * AppPage → EntityListWorkspace → StatusBadge / ErrorPanel / common toolbar。
 * 保留 Batch B2 的「+ 新建入库单」入口；不改 backend / 状态机 / action。
 */
import { useState } from "react";
import Link from "next/link";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge, ConfirmActionDialog } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";

interface WarehouseReceiptRow {
  id: string;
  code: string;
  status: string;
  postedAt?: string | null;
  purchaseReceipt?: { code: string | null } | null;
  warehouse?: { name: string | null } | null;
  location?: { name: string | null } | null;
  _count?: { lines: number };
}

const STATUS_OPTIONS = ["DRAFT", "POSTED", "CANCELLED"] as const;

/** 状态中文业务名（Business UX Rationalization：枚举展示中文，不展示数据库枚举值；key 保留真实 enum） */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  POSTED: "已过账",
  CANCELLED: "已取消",
};

function WarehouseReceiptList() {
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("warehouse-receipt", "create"));
  const canDelete = hasPermission(state.user?.roles as RoleCode[], actionPermission("warehouse-receipt", "delete"));
  const toast = useToast();
  const [deleting, setDeleting] = useState<WarehouseReceiptRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ code?: string; status?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<WarehouseReceiptRow>("/api/warehouse-receipts", filters);

  const applyFilter = () => {
    const next: { code?: string; status?: string } = {};
    if (codeInput.trim()) next.code = codeInput.trim();
    if (statusInput) next.status = statusInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setCodeInput("");
    setStatusInput("");
    setFilters({});
    setPage(1);
  };

  const runDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await apiFetch("/api/warehouse-receipts/" + deleting.id, { method: "DELETE" });
      toast.success("入库单已删除");
      setDeleting(null);
      refresh();
    } catch (err: unknown) {
      const e = err instanceof ApiClientError ? err : new ApiClientError(0, "删除失败", "NETWORK_ERROR");
      toast.error("删除失败", e.message);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <AppPage>
      <EntityListWorkspace<WarehouseReceiptRow>
        title="仓库收货"
        description="仓库收货/入库工作台"
        emptyMessage="暂无仓库收货单——点击「+ 新建仓库收货单」创建第一张入库单"
        headerActions={
          canCreate ? (
            <Link
              href="/purchasing/warehouse-receipts/new"
              className={BUTTON_PRIMARY_CLASS}
            >
              + 新建入库单
            </Link>
          ) : undefined
        }
        filters={
          <>
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按入库单号搜索"
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
            key: "code",
            header: "入库单号",
            render: (row) => (
              <Link
                href={`/purchasing/warehouse-receipts/${row.id}`}
                className="font-medium text-brand-600 hover:underline"
              >
                {row.code}
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
            key: "purchaseReceipt",
            header: "来源收货单",
            render: (row) => row.purchaseReceipt?.code ?? "—",
          },
          {
            key: "warehouse",
            header: "仓库",
            render: (row) => row.warehouse?.name ?? "—",
          },
          {
            key: "location",
            header: "库位",
            render: (row) => row.location?.name ?? "—",
          },
          {
            key: "lines",
            header: "行数",
            render: (row) => String(row._count?.lines ?? 0),
          },
          {
            key: "postedAt",
            header: "过账日期",
            render: (row) => formatDate(row.postedAt),
          },
          {
            key: "actions",
            header: "操作",
            render: (row) =>
              canDelete && ["DRAFT", "CANCELLED"].includes(row.status) ? (
                <button
                  type="button"
                  onClick={() => setDeleting(row)}
                  disabled={deleteBusy}
                  className="rounded-md border border-status-danger-border px-2 py-1 text-xs text-status-danger-text hover:bg-status-danger-bg/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  删除
                </button>
              ) : null,
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
        title={"删除入库单「" + (deleting?.code ?? "") + "」？"}
        description="仅未过账（草稿/已取消）入库单可删除；已过账（POSTED）已形成库存/GRIR 事实，禁止删除。"
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
    <PermissionGuard permission={PERMISSIONS.WAREHOUSE_RECEIPT_READ}>
      <WarehouseReceiptList />
    </PermissionGuard>
  );
}