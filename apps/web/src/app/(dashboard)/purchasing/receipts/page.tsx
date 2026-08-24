"use client";

/**
 * Purchase Receipts — 到货收货列表页（F2-3 Batch C1 Consolidation，CTO #11888）
 *
 * 由旧式自绘 table/filter 迁移至统一 Workspace：
 * AppPage → EntityListWorkspace → StatusBadge / ErrorPanel / common toolbar。
 * 保留 Batch B1 的「+ 新建收货单」入口；不改 backend / 状态机 / action。
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

interface ReceiptRow {
  id: string;
  code: string;
  status: string;
  receivedAt?: string | null;
  purchaseOrder?: { code: string | null } | null;
  supplier?: { name: string | null } | null;
  warehouse?: { name: string | null } | null;
  _count?: { lines: number };
}

const STATUS_OPTIONS = ["DRAFT", "RECEIVED", "CANCELLED"] as const;

/** 状态中文业务名（Business UX Rationalization：枚举展示中文，不展示数据库枚举值；key 保留真实 enum） */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  RECEIVED: "已收货",
  CANCELLED: "已取消",
};

function ReceiptList() {
  const { state } = useSession();
  const toast = useToast();
  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("purchase-receipt", "create"));
  const canEdit = hasPermission(roles, actionPermission("purchase-receipt", "edit"));
  const canDelete = hasPermission(roles, actionPermission("purchase-receipt", "delete"));
  const [codeInput, setCodeInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ code?: string; status?: string }>({});
  const [deleting, setDeleting] = useState<ReceiptRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [unreceiving, setUnreceiving] = useState<ReceiptRow | null>(null);
  const [unreceiveBusy, setUnreceiveBusy] = useState(false);

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<ReceiptRow>("/api/purchase-receipts", filters);

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
      await apiFetch("/api/purchase-receipts/" + deleting.id, { method: "DELETE" });
      toast.success("收货单已删除");
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

  const runUnreceive = async () => {
    if (!unreceiving || unreceiveBusy) return;
    setUnreceiveBusy(true);
    try {
      await apiFetch("/api/purchase-receipts/" + unreceiving.id + "/unreceive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changeReason: "反收货" }),
      });
      toast.success("已反收货");
      setUnreceiving(null);
      refresh();
    } catch (err) {
      const e = err instanceof ApiClientError ? err : new ApiClientError(0, "反收货失败", "NETWORK_ERROR");
      toast.error("反收货失败", e.message);
      setUnreceiving(null);
      refresh();
    } finally {
      setUnreceiveBusy(false);
    }
  };

  return (
    <AppPage>
      <EntityListWorkspace<ReceiptRow>
        title="到货收货"
        description="到货收货仪表盘"
        emptyMessage="暂无到货收货单——点击「+ 新建到货收货单」创建第一张收货单"
        headerActions={
          canCreate ? (
            <Link
              href="/purchasing/receipts/new"
              className={BUTTON_PRIMARY_CLASS}
            >
              + 新建收货单
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
              placeholder="按收货单号搜索"
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
            header: "收货单号",
            render: (row) => (
              <Link
                href={`/purchasing/receipts/${row.id}`}
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
            key: "purchaseOrder",
            header: "采购订单",
            render: (row) => row.purchaseOrder?.code ?? "—",
          },
          {
            key: "supplier",
            header: "供应商",
            render: (row) => row.supplier?.name ?? "—",
          },
          {
            key: "warehouse",
            header: "仓库",
            render: (row) => row.warehouse?.name ?? "—",
          },
          {
            key: "lines",
            header: "行数",
            render: (row) => String(row._count?.lines ?? 0),
          },
          {
            key: "receivedAt",
            header: "收货日期",
            render: (row) => formatDate(row.receivedAt),
          },
          {
            key: "actions",
            header: "操作",
            render: (row) => (
              <div className="flex items-center gap-2">
                {row.status === "RECEIVED" && canEdit && (
                  <button
                    type="button"
                    onClick={() => setUnreceiving(row)}
                    disabled={unreceiveBusy || deleteBusy}
                    className="rounded-md border border-border px-2 py-1 text-xs text-ink-primary hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {unreceiveBusy && unreceiving?.id === row.id ? "反收货中…" : "反收货"}
                  </button>
                )}
                {["DRAFT", "CANCELLED"].includes(row.status) && canDelete && (
                  <button
                    type="button"
                    onClick={() => setDeleting(row)}
                    disabled={unreceiveBusy || deleteBusy}
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
        title={"删除收货单「" + (deleting?.code ?? "") + "」？"}
        description="仅草稿/已取消状态的收货单可删除；删除后列表不再展示。"
        confirmLabel="确认删除"
        tone="danger"
        busy={deleteBusy}
        onConfirm={runDelete}
        onCancel={() => setDeleting(null)}
      />

      <ConfirmActionDialog
        open={unreceiving !== null}
        title={"反收货「" + (unreceiving?.code ?? "") + "」？"}
        description="反收货（RECEIVED → 草稿）：撤销本次收货，回滚库存与 GRIR 入账，可重新编辑/收货。"
        confirmLabel="确认反收货"
        tone="danger"
        busy={unreceiveBusy}
        onConfirm={runUnreceive}
        onCancel={() => setUnreceiving(null)}
      />
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.PURCHASE_RECEIPT_READ}>
      <ReceiptList />
    </PermissionGuard>
  );
}