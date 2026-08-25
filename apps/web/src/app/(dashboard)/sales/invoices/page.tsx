"use client";

/**
 * Sales Invoices — 销售发票列表页（F2-6A Sales Read Foundation）
 *
 * 只读 List：AppPage → EntityListWorkspace → useListQuery。
 * 不提供新建按钮（Invoice 唯一入口是 Delivery，F2-6B）。
 * 注意：DRAFT 发票不占号（code 可空）→ 显示 "—"。
 * PermissionGuard 对齐 API requirePermission("invoice:view")。
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
import { INVOICE_TYPE_LABELS } from "@/lib/vat-labels";

interface InvoiceRow {
  id: string;
  code: string | null;
  status: string;
  invoiceDate: string;
  dueDate?: string | null;
  currency: string;
  invoiceTotal: string;
  paidAmount: string;
  balanceAmount: string;
  invoiceType?: string | null;
  redLetter?: boolean;
  customer?: { id: string; code: string | null; name: string | null } | null;
  delivery?: { id: string; code: string | null; status: string | null } | null;
  _count?: { lines: number };
}

function InvoiceList() {
  const router = useRouter();
  const toast = useToast();
  const { state } = useSession();
  const canDelete = hasPermission((state.user?.roles ?? []) as RoleCode[], actionPermission("invoice", "delete"));
  const [deleting, setDeleting] = useState<InvoiceRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ code?: string; status?: string }>({});

  const [summary, setSummary] = useState<ModuleSummaryData | null>(null);

  // 页面仪表盘 KPI：只读汇总（GET /api/invoices/summary）；失败静默隐藏
  useEffect(() => {
    let cancelled = false;
    apiFetch<ModuleSummaryData>("/api/invoices/summary")
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
    useListQuery<InvoiceRow>("/api/invoices", filters);

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
      await apiFetch("/api/invoices/" + deleting.id, { method: "DELETE" });
      toast.success("发票已删除");
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
        statuses={SALES_STATUS_OPTIONS.invoice.map((s) => ({ value: s, label: salesStatusLabel("invoice", s) }))}
        data={summary}
        activeStatus={filters.status ?? null}
        onSelectStatus={selectStatus}
      />
      <EntityListWorkspace<InvoiceRow>
        title="销售发票"
        description="销售发票列表（唯一创建入口：送货单）"
        emptyMessage="暂无销售发票——发票由送货单创建（送货单详情 → 创建发票）"
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
              {SALES_STATUS_OPTIONS.invoice.map((s) => (
                <option key={s} value={s}>
                  {salesStatusLabel("invoice", s)}
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
            sortable: true,
            render: (row) =>
              row.code ? (
                <Link
                  href={`/sales/invoices/${row.id}`}
                  className="font-medium text-brand-600 hover:underline"
                >
                  {row.code}
                </Link>
              ) : (
                <Link
                  href={`/sales/invoices/${row.id}`}
                  className="text-ink-secondary hover:underline"
                >
                  （草稿）
                </Link>
              ),
          },
          {
            key: "status",
            header: "状态",
            sortable: true,
            render: (row) => (
              <StatusBadge
                status={row.status}
                label={salesStatusLabel("invoice", row.status)}
                tone={salesStatusTone("invoice", row.status)}
              />
            ),
          },
          {
            key: "invoiceType",
            header: "发票类型",
            render: (row) =>
              row.invoiceType ? (
                <span className="inline-flex items-center gap-1">
                  <span className="rounded bg-canvas px-1.5 py-0.5 text-xs text-ink-primary">
                    {INVOICE_TYPE_LABELS[row.invoiceType] ?? row.invoiceType}
                  </span>
                  {row.redLetter ? (
                    <span className="rounded bg-status-danger-bg/20 px-1.5 py-0.5 text-xs text-status-danger-text">
                      红字
                    </span>
                  ) : null}
                </span>
              ) : (
                "—"
              ),
          },
          {
            key: "customer",
            header: "客户",
            render: (row) => row.customer?.name ?? "—",
          },
          {
            key: "delivery",
            header: "来源送货单",
            render: (row) =>
              row.delivery ? (
                <Link
                  href={`/sales/deliveries/${row.delivery.id}`}
                  className="text-brand-600 hover:underline"
                >
                  {row.delivery.code}
                </Link>
              ) : (
                "—"
              ),
          },
          {
            key: "invoiceDate",
            header: "开票日期",
            sortable: true,
            render: (row) => formatDate(row.invoiceDate),
          },
          {
            key: "invoiceTotal",
            header: "含税合计",
            align: "right",
            sortable: true,
            render: (row) => formatMoney(row.invoiceTotal, row.currency),
          },
          {
            key: "balanceAmount",
            header: "应收余额",
            align: "right",
            sortable: true,
            render: (row) => formatMoney(row.balanceAmount, row.currency),
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
              { key: "view", label: "查看详情", onSelect: () => router.push("/sales/invoices/" + row.id) },
              ...(canDelete &&
              (row.status === "CANCELLED" || (row.redLetter === true && (row.status === "DRAFT" || row.status === "ISSUED")))
                ? [{ key: "delete", label: "删除", tone: "danger" as const, onSelect: () => setDeleting(row) }]
                : []),
            ]}
          />
        )}
      />
      <ConfirmActionDialog
        open={deleting !== null}
        title={"删除发票「" + (deleting?.code ?? deleting?.id ?? "") + "」？"}
        description="蓝票仅已取消（CANCELLED）且无应收可删；红字发票（草稿/已开票/已取消）可删——已开票红字删除 = 撤销红冲恢复原票应收（原票应收不存在时直接删）。"
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
    <PermissionGuard permission={actionPermission("invoice", "view")}>
      <InvoiceList />
    </PermissionGuard>
  );
}