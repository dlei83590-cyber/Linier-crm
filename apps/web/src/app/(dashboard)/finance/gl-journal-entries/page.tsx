"use client";

/** GL 记账凭证 — 只读列表页（Sprint 7 Finance 首块，ADR-0033；事件驱动自动过账，无手工过账 UI） */
import { useEffect, useState } from "react";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityListWorkspace, StatusBadge, ModuleKpiStrip } from "@/components/workspace";
import { apiFetch } from "@/lib/api-client";
import type { ModuleSummaryData } from "@/lib/module-summary/types";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate, formatMoney } from "@/lib/format";
import { VOUCHER_TYPE_LABELS } from "@/lib/vat-labels";

interface GlEntryRow {
  id: string;
  voucherNo: string | null;
  postingDate: string;
  status: string;
  sourceType: string;
  sourceId: string;
  summary: string | null;
  totalDebit: string;
  totalCredit: string;
  lineCount: number;
  voucherType?: string | null;
  attachmentCount?: number | null;
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "已提交",
  APPROVED: "已批准",
  POSTED: "已过账",
  REJECTED: "已驳回",
};

const SOURCE_LABELS: Record<string, string> = {
  SupplierInvoicePosted: "发票过账",
  SupplierPaymentApplied: "付款核销",
  SupplierCreditDebitNoteApplied: "贷/借项应用",
  SupplierPaymentReversed: "付款冲销",
};

function GlEntryList() {
  const [sourceTypeInput, setSourceTypeInput] = useState("");
  const [filters, setFilters] = useState<{ sourceType?: string; status?: string }>({});

  const [summary, setSummary] = useState<ModuleSummaryData | null>(null);

  // 页面仪表盘 KPI：只读汇总（GET /api/gl/journal-entries/summary）；失败静默隐藏
  useEffect(() => {
    let cancelled = false;
    apiFetch<ModuleSummaryData>("/api/gl/journal-entries/summary")
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
    useListQuery<GlEntryRow>("/api/gl/journal-entries", filters);

  const applyFilter = () => {
    const next: { sourceType?: string; status?: string } = {};
    if (sourceTypeInput) next.sourceType = sourceTypeInput;
    setFilters(next);
    setPage(1);
  };
  const resetFilter = () => { setSourceTypeInput(""); setFilters({}); setPage(1); };

  return (
    <AppPage>
      <ModuleKpiStrip
        statuses={Object.keys(STATUS_LABELS).map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s }))}
        data={summary}
        activeStatus={filters.status ?? null}
        onSelectStatus={selectStatus}
      />
      <EntityListWorkspace<GlEntryRow>
        title="记账凭证"
        description="GL 过账消费 5C 会计事件自动生成（借贷平衡、幂等、POSTED 终态不可变）；无手工录入"
        emptyMessage="暂无 GL 凭证——发票/付款/调整过账后自动生成"
        filters={
          <>
            <select value={sourceTypeInput} onChange={(e) => setSourceTypeInput(e.target.value)} className={SELECT_CLASS}>
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
            <button type="button" onClick={applyFilter} className={BUTTON_PRIMARY_CLASS}>查询</button>
            <button type="button" onClick={resetFilter} className={BUTTON_SECONDARY_CLASS}>重置</button>
          </>
        }
        columns={[
          { key: "voucherNo", header: "凭证号", sortable: true, render: (row) => (<Link href={`/finance/gl-journal-entries/${row.id}`} className="font-medium text-brand-600 hover:underline">{row.voucherNo ?? "（未取号）"}</Link>) },
          { key: "postingDate", header: "过账日期", sortable: true, render: (row) => formatDate(row.postingDate) },
          {
            key: "voucherType",
            header: "凭证字",
            render: (row) => (
              <span className="rounded bg-canvas px-1.5 py-0.5 text-xs text-ink-primary">
                {VOUCHER_TYPE_LABELS[row.voucherType ?? "GENERAL"] ?? row.voucherType ?? "记"}
              </span>
            ),
          },
          { key: "sourceType", header: "来源", render: (row) => SOURCE_LABELS[row.sourceType] ?? row.sourceType },
          { key: "summary", header: "摘要", render: (row) => row.summary ?? "—" },
          { key: "totalDebit", header: "借方合计", align: "right", sortable: true, render: (row) => formatMoney(row.totalDebit, "CNY") },
          { key: "totalCredit", header: "贷方合计", align: "right", sortable: true, render: (row) => formatMoney(row.totalCredit, "CNY") },
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