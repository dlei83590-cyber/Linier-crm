"use client";

/**
 * Supplier Invoices — 供应商发票列表页（F2-6B 批 3，F2-6 开放）
 *
 * 只读 List：AppPage → EntityListWorkspace → useListQuery。
 * 消费 FINAL 契约 GET /api/supplier-invoices（分页 + invoiceNo/supplierId/documentStatus 过滤；形态 B）。
 * 提供「新建供应商发票」入口（supplier-invoice:create）。
 * PermissionGuard 对齐 API requirePermission("supplier-invoice:view")。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import type { StatusTone } from "@/components/design-system";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge, ConfirmActionDialog } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
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

/** 状态中文业务名（Business UX Rationalization：枚举展示中文，不展示数据库枚举值；key 保留真实 enum） */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "已提交",
  MATCHED: "已匹配",
  APPROVED: "已批准",
  POSTED: "已过账",
};

const TONE_MAP: Record<string, StatusTone> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  MATCHED: "info",
  APPROVED: "success",
  POSTED: "success",
};

function SupplierInvoiceList() {
  const { state } = useSession();
  const toast = useToast();
  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("supplier-invoice", "create"));
  const canDelete = hasPermission(roles, actionPermission("supplier-invoice", "delete"));
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string | null }>>([]);
  const [supplierInput, setSupplierInput] = useState("");
  const [dateFromInput, setDateFromInput] = useState("");
  const [dateToInput, setDateToInput] = useState("");
  const [noInput, setNoInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ invoiceNo?: string; supplierId?: string; documentStatus?: string; dateFrom?: string; dateTo?: string }>({});
  const [deleting, setDeleting] = useState<SupplierInvoiceRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    apiFetch<Array<{ id: string; name: string | null }>>("/api/suppliers?pageSize=100")
      .then((body) => setSuppliers(Array.isArray(body.data) ? body.data : []))
      .catch(() => undefined);
  }, []);

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<SupplierInvoiceRow>("/api/supplier-invoices", filters);

  const applyFilter = () => {
    const next: { invoiceNo?: string; supplierId?: string; documentStatus?: string; dateFrom?: string; dateTo?: string } = {};
    if (noInput.trim()) next.invoiceNo = noInput.trim();
    if (supplierInput) next.supplierId = supplierInput;
    if (dateFromInput) next.dateFrom = dateFromInput;
    if (dateToInput) next.dateTo = dateToInput;
    if (statusInput) next.documentStatus = statusInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setNoInput("");
    setSupplierInput("");
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
      await apiFetch("/api/supplier-invoices/" + deleting.id, { method: "DELETE" });
      toast.success("供应商发票已删除");
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
      <EntityListWorkspace<SupplierInvoiceRow>
        title="供应商发票"
        description="供应商发票（RECEIPT_BASED 三重匹配 + AP 应付）"
        emptyMessage="暂无供应商发票——点击「+ 新建供应商发票」创建第一张发票"
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
            <select value={supplierInput} onChange={(e) => setSupplierInput(e.target.value)} className={SELECT_CLASS}>
              <option value="">全部供应商</option>
              {suppliers.map((s) => (<option key={s.id} value={s.id}>{s.name ?? s.id}</option>))}
            </select>
            <input type="date" value={dateFromInput} onChange={(e) => setDateFromInput(e.target.value)} className={SELECT_CLASS} />
            <input type="date" value={dateToInput} onChange={(e) => setDateToInput(e.target.value)} className={SELECT_CLASS} />
            <select
              value={statusInput}
              onChange={(e) => setStatusInput(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">全部状态</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s] ?? s}
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
            sortable: true,
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
            sortable: true,
            render: (row) => (
              <StatusBadge
                status={row.documentStatus}
                label={STATUS_LABELS[row.documentStatus] ?? row.documentStatus}
                toneMap={TONE_MAP}
              />
            ),
          },
          {
            key: "supplier",
            header: "供应商",
            render: (row) => row.supplier?.name ?? "—",
          },
          {
            key: "invoiceDate",
            header: "开票日期",
            sortable: true,
            render: (row) => formatDate(row.invoiceDate),
          },
          {
            key: "grossAmount",
            header: "价税合计",
            align: "right",
            sortable: true,
            render: (row) => formatMoney(row.grossAmount, row.currency),
          },
          {
            key: "lines",
            header: "行数",
            render: (row) => String(row._count?.lines ?? 0),
          },
          {
            key: "actions",
            header: "操作",
            render: (row) => (
              <div className="flex items-center gap-2">
                {["DRAFT", "SUBMITTED", "CANCELLED"].includes(row.documentStatus) && canDelete && (
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
        title={"删除供应商发票「" + (deleting?.invoiceNo ?? "") + "」？"}
        description="仅草稿/已提交/已取消状态的供应商发票可删除；删除后列表不再展示。"
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
    <PermissionGuard permission={actionPermission("supplier-invoice", "view")}>
      <SupplierInvoiceList />
    </PermissionGuard>
  );
}