"use client";

/**
 * Quotations — 报价单列表页（F2-6A Sales Read Foundation，CTO FINAL APPROVED 后启动）
 *
 * 只读 List：AppPage → EntityListWorkspace → useListQuery。
 * 不改 backend / 状态机 / action；不提供新建按钮（Direct Create 属 F2-6B）。
 * PermissionGuard 对齐 API requirePermission("quotation:view")（三层一致铁律）。
 */
import { useState } from "react";
import Link from "next/link";
import { actionPermission } from "@nilier-crm/shared";
import type { StatusTone } from "@/components/design-system";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate, formatMoney } from "@/lib/format";

interface QuotationRow {
  id: string;
  code: string;
  status: string;
  effectiveStatus?: string;
  quoteDate: string;
  validUntil?: string | null;
  currency: string;
  totalAmount: string;
  customer?: { id: string; code: string | null; name: string | null } | null;
  _count?: { lines: number };
}

const STATUS_OPTIONS = ["DRAFT", "SUBMITTED", "APPROVED", "SENT", "ACCEPTED", "REJECTED", "CANCELLED", "CONVERTED"] as const;

const TONE_MAP: Record<string, StatusTone> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  APPROVED: "success",
  SENT: "info",
  ACCEPTED: "success",
  REJECTED: "danger",
  CANCELLED: "danger",
  CONVERTED: "info",
  EXPIRED: "warning",
};

function QuotationList() {
  const [codeInput, setCodeInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ code?: string; status?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<QuotationRow>("/api/quotations", filters);

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
      <EntityListWorkspace<QuotationRow>
        title="报价单"
        description="销售报价单列表"
        filters={
          <>
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按单号搜索"
              className="w-40 rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            />
            <select
              value={statusInput}
              onChange={(e) => setStatusInput(e.target.value)}
              className="rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
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
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              查询
            </button>
            <button
              type="button"
              onClick={resetFilter}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-slate-50"
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
                href={`/sales/quotations/${row.id}`}
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
              <StatusBadge status={row.effectiveStatus ?? row.status} toneMap={TONE_MAP} />
            ),
          },
          {
            key: "customer",
            header: "客户",
            render: (row) => row.customer?.name ?? "—",
          },
          {
            key: "quoteDate",
            header: "报价日期",
            render: (row) => formatDate(row.quoteDate),
          },
          {
            key: "validUntil",
            header: "有效期至",
            render: (row) => formatDate(row.validUntil),
          },
          {
            key: "totalAmount",
            header: "含税合计",
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
      />
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("quotation", "view")}>
      <QuotationList />
    </PermissionGuard>
  );
}
