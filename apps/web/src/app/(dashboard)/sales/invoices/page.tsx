"use client";

/**
 * Sales Invoices — 销售发票列表页（F2-6A Sales Read Foundation）
 *
 * 只读 List：AppPage → EntityListWorkspace → useListQuery。
 * 不提供新建按钮（Invoice 唯一入口是 Delivery，F2-6B）。
 * 注意：DRAFT 发票不占号（code 可空）→ 显示 "—"。
 * PermissionGuard 对齐 API requirePermission("invoice:view")。
 */
import { useState } from "react";
import Link from "next/link";
import { actionPermission } from "@nilier-crm/shared";
import type { StatusTone } from "@/components/design-system";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
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

const STATUS_OPTIONS = ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "CANCELLED"] as const;

const TONE_MAP: Record<string, StatusTone> = {
  DRAFT: "neutral",
  ISSUED: "info",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  CANCELLED: "danger",
};

function InvoiceList() {
  const [codeInput, setCodeInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ code?: string; status?: string }>({});

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

  return (
    <AppPage>
      <EntityListWorkspace<InvoiceRow>
        title="销售发票"
        description="销售发票列表（唯一创建入口：送货单）"
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
                  {s}
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
            render: (row) => <StatusBadge status={row.status} toneMap={TONE_MAP} />,
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