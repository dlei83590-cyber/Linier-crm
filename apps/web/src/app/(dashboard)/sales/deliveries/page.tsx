"use client";

/**
 * Deliveries — 送货单列表页（F2-6A Sales Read Foundation）
 *
 * 只读 List：AppPage → EntityListWorkspace → useListQuery。
 * 不提供新建按钮（Delivery 唯一入口是 Sales Order，F2-6B）。
 * PermissionGuard 对齐 API requirePermission("delivery:view")。
 */
import { useState } from "react";
import Link from "next/link";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import type { StatusTone } from "@/components/design-system";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge, ConfirmActionDialog } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/session-context";
import { formatDate } from "@/lib/format";

interface DeliveryRow {
  id: string;
  code: string;
  status: string;
  deliveryDate: string;
  customer?: { id: string; code: string | null; name: string | null } | null;
  salesOrder?: { id: string; code: string | null; status: string | null } | null;
  _count?: { lines: number };
}

const STATUS_OPTIONS = ["DRAFT", "READY", "DISPATCHED", "DELIVERED", "COMPLETED", "CANCELLED"] as const;

/** 状态中文业务名（Business UX Rationalization：枚举展示中文，不展示数据库枚举值；key 保留真实 enum） */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  READY: "待发运",
  DISPATCHED: "已发运",
  DELIVERED: "已送达",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};

const TONE_MAP: Record<string, StatusTone> = {
  DRAFT: "neutral",
  READY: "info",
  DISPATCHED: "info",
  DELIVERED: "success",
  COMPLETED: "success",
  CANCELLED: "danger",
};

function DeliveryList() {
  const toast = useToast();
  const { state } = useSession();
  const canDelete = hasPermission((state.user?.roles ?? []) as RoleCode[], actionPermission("delivery", "delete"));
  const [deleting, setDeleting] = useState<DeliveryRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ code?: string; status?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<DeliveryRow>("/api/deliveries", filters);

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
      await apiFetch("/api/deliveries/" + deleting.id, { method: "DELETE" });
      toast.success("送货单已删除");
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
      <EntityListWorkspace<DeliveryRow>
        title="送货单"
        description="送货单列表（唯一创建入口：销售订单）"
        emptyMessage="暂无送货单——送货单由销售订单创建（订单详情 → 创建送货单）"
        filters={
          <>
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按单号搜索"
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
            header: "单号",
            render: (row) => (
              <Link
                href={`/sales/deliveries/${row.id}`}
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
              <StatusBadge
                status={row.status}
                label={STATUS_LABELS[row.status] ?? row.status}
                toneMap={TONE_MAP}
              />
            ),
          },
          {
            key: "customer",
            header: "客户",
            render: (row) => row.customer?.name ?? "—",
          },
          {
            key: "salesOrder",
            header: "来源销售订单",
            render: (row) =>
              row.salesOrder ? (
                <Link
                  href={`/sales/orders/${row.salesOrder.id}`}
                  className="text-brand-600 hover:underline"
                >
                  {row.salesOrder.code}
                </Link>
              ) : (
                "—"
              ),
          },
          {
            key: "deliveryDate",
            header: "交付日期",
            render: (row) => formatDate(row.deliveryDate),
          },
          {
            key: "lines",
            header: "行数",
            render: (row) => String(row._count?.lines ?? 0),
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
        rowActions={(row) =>
          canDelete && row.status === "CANCELLED" ? (
            <div className="flex justify-end gap-1">
              <button type="button" onClick={() => setDeleting(row)} className="rounded-md border border-status-danger-border px-2 py-1 text-xs text-status-danger-text transition-colors hover:bg-red-50">
                删除
              </button>
            </div>
          ) : undefined
        }
      />
      <ConfirmActionDialog
        open={deleting !== null}
        title={"删除送货单「" + (deleting?.code ?? "") + "」？"}
        description="仅已取消（CANCELLED）且无发票的送货单可删除（回退后清理列表）。"
        confirmLabel="删除"
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
    <PermissionGuard permission={actionPermission("delivery", "view")}>
      <DeliveryList />
    </PermissionGuard>
  );
}