"use client";

/** Supplier CN/DN — 供应商贷项/借项列表页（5C-2，CTO 解锁 2026-08-19） */
import { useEffect, useState } from "react";
import Link from "next/link";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge, ConfirmActionDialog, ModuleKpiStrip } from "@/components/workspace";
import type { ModuleSummaryData } from "@/lib/module-summary/types";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate, formatMoney } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";

interface CnDnRow {
  id: string;
  code: string;
  noteType: string;
  currency: string;
  adjustmentTotal: string;
  status: string;
  appliedAt?: string | null;
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
  const toast = useToast();
  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("supplier-credit-debit-note", "create"));
  const canDelete = hasPermission(roles, actionPermission("supplier-credit-debit-note", "delete"));
  const [typeInput, setTypeInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ noteType?: string; status?: string }>({});
  const [deleting, setDeleting] = useState<CnDnRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [summary, setSummary] = useState<ModuleSummaryData | null>(null);

  // 页面仪表盘 KPI：只读汇总（GET /api/supplier-credit-debit-notes/summary）；失败静默隐藏
  useEffect(() => {
    let cancelled = false;
    apiFetch<ModuleSummaryData>("/api/supplier-credit-debit-notes/summary")
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
    useListQuery<CnDnRow>("/api/supplier-credit-debit-notes", filters);

  const applyFilter = () => {
    const next: { noteType?: string; status?: string } = {};
    if (typeInput) next.noteType = typeInput;
    if (statusInput) next.status = statusInput;
    setFilters(next);
    setPage(1);
  };
  const resetFilter = () => { setTypeInput(""); setStatusInput(""); setFilters({}); setPage(1); };

  const runDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await apiFetch("/api/supplier-credit-debit-notes/" + deleting.id, { method: "DELETE" });
      toast.success("贷/借项通知单已删除");
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
        statuses={Object.keys(STATUS_LABELS).map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s }))}
        data={summary}
        activeStatus={filters.documentStatus ?? filters.status ?? null}
        onSelectStatus={selectStatus}
      />
      <EntityListWorkspace<CnDnRow>
        title="供应商贷项/借项"
        description="供应商开给我方的 AP 侧调整单据（贷项冲减应付 / 借项增加应付；APPLIED 才回写应付未结项）"
        emptyMessage="暂无 AP 调整单据——点击「+ 新建」创建第一张调整单"
        headerActions={
          canCreate ? (
            <Link href="/supplier-ap/credit-debit-notes/new" className={BUTTON_PRIMARY_CLASS}>
              + 新建贷/借项
            </Link>
          ) : undefined
        }
        filters={
          <>
            <select value={typeInput} onChange={(e) => setTypeInput(e.target.value)} className={SELECT_CLASS}>
              <option value="">全部类型</option>
              <option value="CREDIT">贷项（冲减应付）</option>
              <option value="DEBIT">借项（增加应付）</option>
            </select>
            <select value={statusInput} onChange={(e) => setStatusInput(e.target.value)} className={SELECT_CLASS}>
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
          { key: "adjustmentTotal", header: "调整金额", align: "right", render: (row) => formatMoney(row.adjustmentTotal, row.currency) },
          { key: "status", header: "状态", render: (row) => (<StatusBadge status={row.status} label={STATUS_LABELS[row.status] ?? row.status} toneMap={STATUS_TONE_MAP} />) },
          { key: "appliedAt", header: "应用日期", render: (row) => formatDate(row.appliedAt) },
          {
            key: "actions",
            header: "操作",
            render: (row) => (
              <div className="flex items-center gap-2">
                {["DRAFT", "SUBMITTED", "CANCELLED"].includes(row.status) && canDelete && (
                  <button
                    type="button"
                    onClick={() => setDeleting(row)}
                    disabled={deleteBusy}
                    className="rounded-md border border-status-danger-border px-2 py-1 text-xs text-status-danger-text hover:bg-status-danger-bg/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    删除
                  </button>
                )}
              </div>
            ),
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

      <ConfirmActionDialog
        open={deleting !== null}
        title={"删除贷/借项通知单「" + (deleting?.code ?? "") + "」？"}
        description="仅草稿/已提交/已取消状态的贷/借项通知单可删除；删除后列表不再展示。"
        confirmLabel="确认删除"
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
    <PermissionGuard permission={actionPermission("supplier-credit-debit-note", "view")}>
      <CnDnList />
    </PermissionGuard>
  );
}