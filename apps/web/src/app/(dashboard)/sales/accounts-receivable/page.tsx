"use client";

/**
 * Accounts Receivable — 应收账款列表页（F2-6A Sales Read Foundation）
 *
 * 只读 List：AppPage → EntityListWorkspace → useListQuery。
 * AR 纯只读模型（无 create/edit），不提供任何写入口。
 * 展示惰性投影 effectiveStatus / effectiveAgingBucket（后端 computeArProjection）。
 * PermissionGuard 对齐 API requirePermission("accounts-receivable:view")。
 */
import { useState } from "react";
import Link from "next/link";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { SALES_STATUS_OPTIONS, salesStatusLabel, salesStatusTone } from "@/lib/sales-status";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate, formatMoney } from "@/lib/format";

interface ArRow {
  id: string;
  status: string;
  effectiveStatus?: string;
  currency: string;
  paidAmount: string;
  balanceAmount: string;
  dueDate?: string | null;
  effectiveAgingBucket?: string | null;
  customer?: { id: string; code: string | null; name: string | null } | null;
  invoice?: {
    id: string;
    code: string | null;
    status: string | null;
    invoiceTotal: string | null;
  } | null;
}

function ArList() {
  const [statusInput, setStatusInput] = useState("");
  // F2-6A REQUEST CHANGES：OVERDUE 是惰性投影（非持久化状态），必须走 effectiveStatus 参数；
  // OPEN/PARTIALLY_PAID/PAID/CLOSED → status；OVERDUE → effectiveStatus（与 backend contract 一致）
  const [filters, setFilters] = useState<{ status?: string; effectiveStatus?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<ArRow>("/api/accounts-receivables", filters);

  const applyFilter = () => {
    const next: { status?: string; effectiveStatus?: string } = {};
    if (statusInput === "OVERDUE") {
      next.effectiveStatus = "OVERDUE";
    } else if (statusInput) {
      next.status = statusInput;
    }
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setStatusInput("");
    setFilters({});
    setPage(1);
  };

  return (
    <AppPage>
      <EntityListWorkspace<ArRow>
        title="应收账款"
        description="应收账款列表（只读）"
        emptyMessage="暂无应收账款——开票后自动生成应收"
        filters={
          <select
            value={statusInput}
            onChange={(e) => setStatusInput(e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">全部状态</option>
            {SALES_STATUS_OPTIONS.ar.map((s) => (
              <option key={s} value={s}>
                {salesStatusLabel("ar", s)}
              </option>
            ))}
          </select>
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
            key: "invoice",
            header: "发票",
            render: (row) =>
              row.invoice ? (
                <Link
                  href={`/sales/invoices/${row.invoice.id}`}
                  className="font-medium text-brand-600 hover:underline"
                >
                  {row.invoice.code ?? "（草稿）"}
                </Link>
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
            key: "effectiveStatus",
            header: "状态",
            render: (row) => (
              <StatusBadge
                status={row.effectiveStatus ?? row.status}
                label={salesStatusLabel("ar", row.effectiveStatus ?? row.status)}
                tone={salesStatusTone("ar", row.effectiveStatus ?? row.status)}
              />
            ),
          },
          {
            key: "dueDate",
            header: "到期日",
            render: (row) => formatDate(row.dueDate),
          },
          {
            key: "agingBucket",
            header: "账龄",
            render: (row) => row.effectiveAgingBucket ?? "—",
          },
          {
            key: "paidAmount",
            header: "已收款",
            align: "right",
            render: (row) => formatMoney(row.paidAmount, row.currency),
          },
          {
            key: "balanceAmount",
            header: "应收余额",
            align: "right",
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
    <PermissionGuard permission={actionPermission("accounts-receivable", "view")}>
      <ArList />
    </PermissionGuard>
  );
}