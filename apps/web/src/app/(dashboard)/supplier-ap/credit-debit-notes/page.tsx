"use client";

/** Supplier CN/DN — 供应商贷项/借项列表页（5C-2，CTO 解锁 2026-08-19） */
import { useState } from "react";
import Link from "next/link";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate, formatMoney } from "@/lib/format";

interface CnDnRow {
  id: string;
  code: string;
  noteType: string;
  currency: string;
  adjustmentTotal: string;
  status: string;
  createdAt: string;
  supplier?: { id: string; code: string; name: string } | null;
  sourceSupplierInvoice?: { invoiceNo: string; supplierInvoiceNo: string } | null;
  invoices?: Array<{ supplierInvoice?: { invoiceNo: string; supplierInvoiceNo: string } | null }> | null;
}

const TYPE_LABELS: Record<string, string> = { CREDIT: "贷项（冲减应付）", DEBIT: "借项（增加应付）" };
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "已提交",
  APPROVED: "已批准",
  APPLIED: "已应用",
  CANCELLED: "已取消",
};
const STATUS_TONE_MAP: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  APPROVED: "success",
  APPLIED: "success",
  CANCELLED: "danger",
};

function CnDnList() {
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("supplier-credit-debit-note", "create"));
  const [typeInput, setTypeInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ noteType?: string; status?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<CnDnRow>("/api/supplier-credit-debit-notes", filters);

  const applyFilter = () => {
    const next: { noteType?: string; status?: string } = {};
    if (typeInput) next.noteType = typeInput;
    if (statusInput) next.status = statusInput;
    setFilters(next);
    setPage(1);
  };
  const resetFilter = () => { setTypeInput(""); setStatusInput(""); setFilters({}); setPage(1); };

  return (
    <AppPage>
      <EntityListWorkspace<CnDnRow>
        title="供应商贷项/借项"
        description="供应商开给我方的 AP 侧调整单据（贷项冲减应付 / 借项增加应付；APPLIED 才回写应付未结项）"
        headerActions={
          canCreate ? (
            <Link href="/supplier-ap/credit-debit-notes/new" className={BUTTON_PRIMARY_CLASS}>
              + 新建贷/借项
            </Link>
          ) : undefined
        }
        filters={
          <>
            <select value={typeInput} onChange={(e) => setTypeInput(e.target.value)} className="rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none">
              <option value="">全部类型</option>
              <option value="CREDIT">贷项（冲减应付）</option>
              <option value="DEBIT">借项（增加应付）</option>
            </select>
            <select value={statusInput} onChange={(e) => setStatusInput(e.target.value)} className="rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none">
              <option value="">全部状态</option>
              <option value="DRAFT">草稿</option>
              <option value="SUBMITTED">已提交</option>
              <option value="APPROVED">已批准</option>
              <option value="APPLIED">已应用</option>
              <option value="CANCELLED">已取消</option>
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
          { key: "code", header: "单据号", render: (row) => (<Link href={`/supplier-ap/credit-debit-notes/${row.id}`} className="font-medium text-brand-600 hover:underline">{row.code}</Link>) },
          { key: "noteType", header: "类型", render: (row) => TYPE_LABELS[row.noteType] ?? row.noteType },
          { key: "supplier", header: "供应商", render: (row) => row.supplier?.name ?? "—" },
          { key: "invoiceNo", header: "来源发票", render: (row) => row.invoices && row.invoices.length > 0 ? row.invoices.map((i) => i.supplierInvoice?.invoiceNo ?? "—").join("、") : row.sourceSupplierInvoice?.invoiceNo ?? "—" },
          { key: "adjustmentTotal", header: "调整金额", render: (row) => formatMoney(row.adjustmentTotal, row.currency) },
          { key: "status", header: "状态", render: (row) => (<StatusBadge status={row.status} label={STATUS_LABELS[row.status] ?? row.status} toneMap={STATUS_TONE_MAP} />) },
          { key: "createdAt", header: "创建时间", render: (row) => formatDate(row.createdAt) },
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
    <PermissionGuard permission={actionPermission("supplier-credit-debit-note", "view")}>
      <CnDnList />
    </PermissionGuard>
  );
}