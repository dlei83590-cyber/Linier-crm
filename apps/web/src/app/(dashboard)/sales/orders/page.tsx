"use client";

/**
 * Sales Orders — 销售订单列表页（F2-6A Sales Read Foundation）
 *
 * 只读 List：AppPage → EntityListWorkspace → useListQuery。
 * 不提供新建按钮（SO 唯一入口是 Quotation Convert，F2-6B）。
 * PermissionGuard 对齐 API requirePermission("sales-order:view")。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge, ConfirmActionDialog, ModuleKpiStrip } from "@/components/workspace";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import type { ModuleSummaryData } from "@/lib/module-summary/types";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { SALES_STATUS_OPTIONS, salesStatusLabel, salesStatusTone } from "@/lib/sales-status";
import { useListQuery } from "@/lib/use-list-query";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/session-context";
import { formatDate, formatMoney } from "@/lib/format";

interface SalesOrderRow {
  id: string;
  code: string;
  status: string;
  orderDate: string;
  currency: string;
  totalAmount: string;
  customer?: { id: string; code: string | null; name: string | null } | null;
  quotation?: { id: string; code: string | null } | null;
  _count?: { lines: number };
}

function SalesOrderList() {
  const router = useRouter();
  const toast = useToast();
  const { state } = useSession();
  const canDelete = hasPermission((state.user?.roles ?? []) as RoleCode[], actionPermission("sales-order", "delete"));
  const [deleting, setDeleting] = useState<SalesOrderRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [customers, setCustomers] = useState<Array<{ id: string; name: string | null }>>([]);
  const [customerInput, setCustomerInput] = useState("");
  const [dateFromInput, setDateFromInput] = useState("");
  const [dateToInput, setDateToInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ code?: string; customerId?: string; status?: string; dateFrom?: string; dateTo?: string }>({});

  useEffect(() => {
    apiFetch<Array<{ id: string; name: string | null }>>("/api/business-partners?pageSize=100&type=CUSTOMER")
      .then((body) => setCustomers(Array.isArray(body.data) ? body.data : []))
      .catch(() => undefined);
  }, []);

  const [summary, setSummary] = useState<ModuleSummaryData | null>(null);

  // 页面仪表盘 KPI：只读汇总（GET /api/sales-orders/summary）；失败静默隐藏
  useEffect(() => {
    let cancelled = false;
    apiFetch<ModuleSummaryData>("/api/sales-orders/summary")
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

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<SalesOrderRow>("/api/sales-orders", filters);

  const applyFilter = () => {
    const next: { code?: string; customerId?: string; status?: string; dateFrom?: string; dateTo?: string } = {};
    if (codeInput.trim()) next.code = codeInput.trim();
    if (customerInput) next.customerId = customerInput;
    if (dateFromInput) next.dateFrom = dateFromInput;
    if (dateToInput) next.dateTo = dateToInput;
    if (statusInput) next.status = statusInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setCodeInput("");
    setCustomerInput("");
    setDateFromInput("");
    setDateToInput("");
    setStatusInput("");
    setFilters({});
    setPage(1);
  };

  const runDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await apiFetch("/api/sales-orders/" + deleting.id, { method: "DELETE" });
      toast.success("销售订单已删除");
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
        statuses={SALES_STATUS_OPTIONS.salesOrder.map((s) => ({ value: s, label: salesStatusLabel("salesOrder", s) }))}
        data={summary}
        activeStatus={filters.status ?? null}
        onSelectStatus={selectStatus}
      />
      <EntityListWorkspace<SalesOrderRow>
        title="销售订单"
        description="销售订单列表（唯一创建入口：报价单 Convert）"
        emptyMessage="暂无销售订单——销售订单由报价单 Convert 创建，请先在报价单详情页执行 Convert"
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
            <select value={customerInput} onChange={(e) => setCustomerInput(e.target.value)} className={SELECT_CLASS}>
              <option value="">全部客户</option>
              {customers.map((c) => (<option key={c.id} value={c.id}>{c.name ?? "（未命名）"}</option>))}
            </select>
            <input type="date" value={dateFromInput} onChange={(e) => setDateFromInput(e.target.value)} className={SELECT_CLASS} />
            <input type="date" value={dateToInput} onChange={(e) => setDateToInput(e.target.value)} className={SELECT_CLASS} />
            <select
              value={statusInput}
              onChange={(e) => setStatusInput(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">全部状态</option>
              {SALES_STATUS_OPTIONS.salesOrder.map((s) => (
                <option key={s} value={s}>
                  {salesStatusLabel("salesOrder", s)}
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
                href={`/sales/orders/${row.id}`}
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
                label={salesStatusLabel("salesOrder", row.status)}
                tone={salesStatusTone("salesOrder", row.status)}
              />
            ),
          },
          {
            key: "customer",
            header: "客户",
            render: (row) => row.customer?.name ?? "—",
          },
          {
            key: "quotation",
            header: "来源报价单",
            render: (row) =>
              row.quotation ? (
                <Link
                  href={`/sales/quotations/${row.quotation.id}`}
                  className="text-brand-600 hover:underline"
                >
                  {row.quotation.code}
                </Link>
              ) : (
                "—"
              ),
          },
          {
            key: "orderDate",
            header: "下单日期",
            render: (row) => formatDate(row.orderDate),
          },
          {
            key: "totalAmount",
            header: "含税合计",
            align: "right",
            render: (row) => formatMoney(row.totalAmount, row.currency),
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
        rowActions={(row) => (
          <RowActionsMenu
            actions={[
              { key: "view", label: "查看详情", onSelect: () => router.push("/sales/orders/" + row.id) },
              ...(canDelete && row.status === "CANCELLED"
                ? [{ key: "delete", label: "删除", tone: "danger" as const, onSelect: () => setDeleting(row) }]
                : []),
            ]}
          />
        )}
      />
      <ConfirmActionDialog
        open={deleting !== null}
        title={"删除销售订单「" + (deleting?.code ?? "") + "」？"}
        description="仅已取消（CANCELLED）且无送货单的销售订单可删除（回退后清理列表）。"
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
    <PermissionGuard permission={actionPermission("sales-order", "view")}>
      <SalesOrderList />
    </PermissionGuard>
  );
}