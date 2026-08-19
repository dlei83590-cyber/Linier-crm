"use client";

/** GL 记账凭证 — 只读列表页（Sprint 7 Finance 首块，ADR-0033；事件驱动自动过账，无手工过账 UI） */
import { useState } from "react";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate, formatMoney } from "@/lib/format";

interface GlEntryRow {
  id: string;
  voucherNo: string;
  postingDate: string;
  status: string;
  sourceType: string;
  sourceId: string;
  summary: string | null;
  totalDebit: string;
  totalCredit: string;
  lineCount: number;
}

const SOURCE_LABELS: Record<string, string> = {
  SupplierInvoicePosted: "发票过账",
  SupplierPaymentApplied: "付款核销",
  SupplierCreditDebitNoteApplied: "贷/借项应用",
  SupplierPaymentReversed: "付款冲销",
};

function GlEntryList() {
  const [sourceTypeInput, setSourceTypeInput] = useState("");
  const [filters, setFilters] = useState<{ sourceType?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<GlEntryRow>("/api/gl/journal-entries", filters);

  const applyFilter = () => {
    const next: { sourceType?: string } = {};
    if (sourceTypeInput) next.sourceType = sourceTypeInput;
    setFilters(next);
    setPage(1);
  };
  const resetFilter = () => { setSourceTypeInput(""); setFilters({}); setPage(1); };

  return (
    <AppPage>
      <EntityListWorkspace<GlEntryRow>
        title="记账凭证"
        description="GL 过账消费 5C 会计事件自动生成（借贷平衡、幂等、POSTED 终态不可变）；无手工录入"
        filters={
          <>
            <select value={sourceTypeInput} onChange={(e) => setSourceTypeInput(e.target.value)} className="rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none">
              <option value="">全部来源</option>
              <option value="SupplierInvoicePosted">发票过账</option>
              <option value="SupplierPaymentApplied">付款核销</option>
              <option value="SupplierCreditDebitNoteApplied">贷/借项应用</option>
              <option value="SupplierPaymentReversed">付款冲销</option>
            </select>
          </>
        }
        toolbarActions={
          <>
            <button type="button" onClick={applyFilter} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">查询</button>
            <button type="button" onClick={resetFilter} className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-slate-50">重置</button>
          </>
        }
        columns={[
          { key: "voucherNo", header: "凭证号", render: (row) => (<Link href={`/finance/gl-journal-entries/${row.id}`} className="font-medium text-brand-600 hover:underline">{row.voucherNo}</Link>) },
          { key: "postingDate", header: "过账日期", render: (row) => formatDate(row.postingDate) },
          { key: "sourceType", header: "来源", render: (row) => SOURCE_LABELS[row.sourceType] ?? row.sourceType },
          { key: "summary", header: "摘要", render: (row) => row.summary ?? "—" },
          { key: "totalDebit", header: "借方合计", render: (row) => formatMoney(row.totalDebit, "CNY") },
          { key: "totalCredit", header: "贷方合计", render: (row) => formatMoney(row.totalCredit, "CNY") },
          { key: "lineCount", header: "行数", render: (row) => row.lineCount },
          { key: "status", header: "状态", render: (row) => (<StatusBadge status={row.status} label="已过账" toneMap={{ POSTED: "success" }} />) },
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
    <PermissionGuard permission={actionPermission("gl", "view")}>
      <GlEntryList />
    </PermissionGuard>
  );
}
