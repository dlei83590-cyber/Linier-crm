"use client";

/**
 * Deliveries — 送货单列表页（F2-6A Sales Read Foundation）
 *
 * 只读 List：AppPage → EntityListWorkspace → useListQuery。
 * 不提供新建按钮（Delivery 唯一入口是 Sales Order，F2-6B）。
 * PermissionGuard 对齐 API requirePermission("delivery:view")。
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge, ConfirmActionDialog, ModuleKpiStrip } from "@/components/workspace";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import type { ModuleSummaryData } from "@/lib/module-summary/types";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { SALES_STATUS_OPTIONS, salesStatusLabel, salesStatusTone } from "@/lib/sales-status";
import { useListQuery, readUrlFilterParams } from "@/lib/use-list-query";
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

function DeliveryList() {
  const router = useRouter();
  const toast = useToast();
  const { state } = useSession();
  const canDelete = hasPermission((state.user?.roles ?? []) as RoleCode[], actionPermission("delivery", "delete"));
  const [deleting, setDeleting] = useState<DeliveryRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ code?: string; status?: string }>({});

  const [summary, setSummary] = useState<ModuleSummaryData | null>(null);

  // 页面仪表盘 KPI：只读汇总（GET /api/deliveries/summary）；失败静默隐藏
  useEffect(() => {
    let cancelled = false;
    apiFetch<ModuleSummaryData>("/api/deliveries/summary")
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
    useListQuery<DeliveryRow>("/api/deliveries", filters, 20, { syncUrl: true });

  // URL 筛选恢复（hydration 后一次性应用；刷新/分享后筛选不丢失）
  const urlRestored = useRef(false);
  useEffect(() => {
    if (urlRestored.current) return;
    urlRestored.current = true;
    const u = readUrlFilterParams(["code", "status"]);
    setCodeInput(u.code ?? "");
    setStatusInput(u.status ?? "");
    setFilters(() => {
      const n: { code?: string; status?: string } = {};
      if (u.code) n.code = u.code;
      if (u.status) n.status = u.status;
      return n;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <ModuleKpiStrip
        statuses={SALES_STATUS_OPTIONS.delivery.map((s) => ({ value: s, label: salesStatusLabel("delivery", s) }))}
        data={summary}
        activeStatus={filters.status ?? null}
        onSelectStatus={selectStatus}
      />
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
              {SALES_STATUS_OPTIONS.delivery.map((s) => (
                <option key={s} value={s}>
                  {salesStatusLabel("delivery", s)}
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
                label={salesStatusLabel("delivery", row.status)}
                tone={salesStatusTone("delivery", row.status)}
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
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        activeFilters={[
          filters.code ? { key: "code", label: `单号：${filters.code}`, onClear: () => { setCodeInput(""); setFilters((prev) => { const n = { ...prev }; delete n.code; return n; }); } } : null,
          filters.status ? { key: "status", label: `状态：${salesStatusLabel("delivery", filters.status)}`, onClear: () => { setStatusInput(""); setFilters((prev) => { const n = { ...prev }; delete n.status; return n; }); } } : null,
        ].filter((c): c is NonNullable<typeof c> => c !== null)}
        rowActions={(row) => (
          <RowActionsMenu
            actions={[
              { key: "view", label: "查看详情", onSelect: () => router.push("/sales/deliveries/" + row.id) },
              ...(canDelete && (row.status === "CANCELLED" || row.status === "DISPATCHED")
                ? [{ key: "delete", label: "删除", tone: "danger" as const, onSelect: () => setDeleting(row) }]
                : []),
            ]}
          />
        )}
      />
      <ConfirmActionDialog
        open={deleting !== null}
        title={"删除送货单「" + (deleting?.code ?? "") + "」？"}
        description="仅已取消（CANCELLED）或反签收后（DISPATCHED）且无发票的送货单可删除；删除后订单交付状态重算（可回未发货）。"
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