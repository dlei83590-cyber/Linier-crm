"use client";

/**
 * Supplier Invoices — 供应商发票列表页（F2-6B 批 3，F2-6 开放）
 *
 * 只读 List：AppPage → EntityListWorkspace → useListQuery。
 * 消费 FINAL 契约 GET /api/supplier-invoices（分页 + invoiceNo/supplierId/documentStatus 过滤；形态 B）。
 * 提供「新建供应商发票」入口（supplier-invoice:create）。
 * PermissionGuard 对齐 API requirePermission("supplier-invoice:view")。
 */
import { useState } from "react";
import Link from "next/link";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import type { StatusTone } from "@/components/design-system";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { useSession } from "@/lib/session-context";
import { formatDate, formatMoney } from "@/lib/format";

interface SupplierInvoiceRow {
  id: string;
  invoiceNo: string;
  supplierInvoiceNo: string;
  documentStatus: string;
  settlementStatus?: string | null;
  invoiceDate: string;
  currency: string;
  grossAmount: string;
  supplier?: { id: string; code: string | null; name: string | null } | null;
  _count?: { lines: number };
}

const STATUS_OPTIONS = ["DRAFT", "SUBMITTED", "MATCHED", "APPROVED", "POSTED"] as const;

const TONE_MAP: Record<string, StatusTone> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  MATCHED: "info",
  APPROVED: "success",
  POSTED: "success",
};

function SupplierInvoiceList() {
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("supplier-invoice", "create"));
  const [noInput, setNoInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ invoiceNo?: string; documentStatus?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<SupplierInvoiceRow>("/api/supplier-invoices", filters);

  const applyFilter = () => {
    const next: { invoiceNo?: string; documentStatus?: string } = {};
    if (noInput.trim()) next.invoiceNo = noInput.trim();
    if (statusInput) next.documentStatus = statusInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setNoInput("");
    setStatusInput("");
    setFilters({});
    setPage(1);
  };

  return (
    <AppPage>
      <EntityListWorkspace<SupplierInvoiceRow>
        title="供应商发票"
        description="供应商发票（RECEIPT_BASED 三重匹配 + AP 应付）"
        headerActions={
          canCreate ? (
            <Link
              href="/supplier-invoices/new"
              className={BUTTON_PRIMARY_CLASS}
            >
              + 新建供应商发票
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
              placeholder="按发票号搜索"
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
            key: "invoiceNo",
            header: "发票号",
            render: (row) => (
              <Link
                href={`/supplier-invoices/${row.id}`}
                className="font-medium text-brand-600 hover:underline"
              >
                {row.invoiceNo}
              </Link>
            ),
          },
          {
            key: "supplierInvoiceNo",
            header: "供应商发票号",
            render: (row) => row.supplierInvoiceNo,
          },
          {
            key: "documentStatus",
            header: "单据状态",
            render: (row) => <StatusBadge status={row.documentStatus} toneMap={TONE_MAP} />,
          },
          {
            key: "supplier",
            header: "供应商",
            render: (row) => row.supplier?.name ?? "—",
          },
          {
            key: "invoiceDate",
            header: "开票日期",
            render: (row) => formatDate(row.invoiceDate),
          },
          {
            key: "grossAmount",
            header: "价税合计",
            render: (row) => formatMoney(row.grossAmount, row.currency),
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
      />
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("supplier-invoice", "view")}>
      <SupplierInvoiceList />
    </PermissionGuard>
  );
}