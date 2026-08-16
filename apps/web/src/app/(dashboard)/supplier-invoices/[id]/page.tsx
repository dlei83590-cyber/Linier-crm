"use client";

/**
 * Supplier Invoice Detail — 供应商发票详情页（F2-6B 批 3，F2-6 开放）
 *
 * 只读 Detail + 事实动作：submit / match（三单匹配）/ post（AP 应付落账）。
 *  - submit（supplier-invoice:edit）：DRAFT → SUBMITTED（version CAS；SUBMITTED ≠ POSTED）
 *  - match（supplier-invoice:edit）：SUBMITTED/MATCHED → MATCHED（服务端三单匹配快照，客户端只传 version）
 *  - post（supplier-invoice:edit）：APPROVED → POSTED（GRIR CONSUME + AP Liability + AP Open Item 同事务，不可逆）
 * 金额/匹配结果全部服务端派生（前端只读）。
 * PermissionGuard 对齐 API requirePermission("supplier-invoice:view")。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import type { StatusTone } from "@/components/design-system";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, ConfirmActionDialog, EntityDetailWorkspace, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { useSession } from "@/lib/session-context";
import { formatDate, formatMoney } from "@/lib/format";

const TONE_MAP: Record<string, StatusTone> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  MATCHED: "info",
  APPROVED: "success",
  POSTED: "success",
};

interface SupplierInvoiceLine {
  id: string;
  lineNo: number;
  quantity: string;
  unitPrice: string;
  netAmount: string;
  taxRate: string;
  taxAmount: string;
  vatRecoverable: boolean;
  item?: { id: string; code: string | null; name: string | null; model?: string | null } | null;
  purchaseOrderLine?: { id: string; lineNo: number; itemId: string; quantity: string; unitPrice: string } | null;
  warehouseReceiptLine?: { id: string; quantity: string; warehouseReceipt?: { id: string; code: string | null; status: string | null } | null } | null;
}

interface SupplierInvoiceDetail {
  id: string;
  version: number;
  invoiceNo: string;
  supplierInvoiceNo: string;
  documentStatus: string;
  settlementStatus?: string | null;
  invoiceDate: string;
  receivedDate?: string | null;
  currency: string;
  exchangeRate: string;
  netAmount: string;
  taxAmount: string;
  grossAmount: string;
  paymentDueDate?: string | null;
  remark?: string | null;
  createdAt: string;
  supplier?: { id: string; code: string | null; name: string | null } | null;
  lines?: SupplierInvoiceLine[];
}

type ConfirmAction = "submit" | "match" | "post";

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
}

function SupplierInvoiceDetailPage() {
  const params = useParams();
  const { state } = useSession();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<SupplierInvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiClientError | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canEdit = hasPermission(roles, actionPermission("supplier-invoice", "edit"));

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<SupplierInvoiceDetail>(`/api/supplier-invoices/${id}`, { signal: controller.signal })
      .then((body) => setDetail(body.data))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id]);

  const refreshDetail = async () => {
    try {
      const body = await apiFetch<SupplierInvoiceDetail>(`/api/supplier-invoices/${id}`);
      setDetail(body.data);
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "刷新失败", "NETWORK_ERROR"),
      );
    }
  };

  const runAction = async (action: ConfirmAction) => {
    if (!detail || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await apiFetch(`/api/supplier-invoices/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: detail.version }),
      });
      await refreshDetail();
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "操作失败", "NETWORK_ERROR"),
      );
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) {
    return (
      <AppPage>
        <div className="border-border bg-surface rounded-lg border p-6 text-sm text-ink-muted">加载中…</div>
      </AppPage>
    );
  }

  if (error || !detail) {
    return (
      <AppPage>
        <ErrorPanel error={error} />
        <Link href="/supplier-invoices" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          返回列表
        </Link>
      </AppPage>
    );
  }

  return (
    <AppPage>
      {actionError && (
        <div className="border-status-danger-border mb-3 rounded-md border bg-status-danger-bg/10 p-3 text-sm text-status-danger-text">
          {describeStatus(actionError.status)}：{actionError.message}
          {actionError.code ? `（${actionError.code}）` : ""}
        </div>
      )}
      <EntityDetailWorkspace
        title={`供应商发票详情 — ${detail.invoiceNo}`}
        backHref="/supplier-invoices"
        status={detail.documentStatus}
        statusTone={TONE_MAP[detail.documentStatus] ?? "neutral"}
        actions={
          canEdit ? (
            <>
              {detail.documentStatus === "DRAFT" && (
                <button
                  type="button"
                  onClick={() => setConfirmAction("submit")}
                  disabled={actionBusy}
                  className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {actionBusy ? "处理中…" : "提交"}
                </button>
              )}
              {(detail.documentStatus === "SUBMITTED" || detail.documentStatus === "MATCHED") && (
                <button
                  type="button"
                  onClick={() => setConfirmAction("match")}
                  disabled={actionBusy}
                  className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {actionBusy ? "处理中…" : "三单匹配"}
                </button>
              )}
              {detail.documentStatus === "APPROVED" && (
                <button
                  type="button"
                  onClick={() => setConfirmAction("post")}
                  disabled={actionBusy}
                  className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {actionBusy ? "处理中…" : "过账（AP）"}
                </button>
              )}
            </>
          ) : undefined
        }
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="发票号" value={detail.invoiceNo} />
            <InfoItem label="供应商发票号" value={detail.supplierInvoiceNo} />
            <InfoItem label="供应商" value={detail.supplier?.name} />
            <InfoItem label="结算状态" value={detail.settlementStatus} />
            <InfoItem label="开票日期" value={formatDate(detail.invoiceDate)} />
            <InfoItem label="收到日期" value={formatDate(detail.receivedDate)} />
            <InfoItem label="币种" value={detail.currency} />
            <InfoItem label="汇率" value={detail.exchangeRate} />
            <InfoItem label="净额" value={formatMoney(detail.netAmount, detail.currency)} />
            <InfoItem label="税额" value={formatMoney(detail.taxAmount, detail.currency)} />
            <InfoItem label="价税合计" value={formatMoney(detail.grossAmount, detail.currency)} />
            <InfoItem label="到期日" value={formatDate(detail.paymentDueDate)} />
            <InfoItem label="备注" value={detail.remark} />
          </div>
        }
      >
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">
            发票行（{detail.lines?.length ?? 0}）
          </h2>
          <div className="overflow-x-auto">
            <table className="divide-border min-w-full divide-y text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium text-ink-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">行号</th>
                  <th className="px-3 py-2 font-medium">物料</th>
                  <th className="px-3 py-2 font-medium">数量</th>
                  <th className="px-3 py-2 font-medium">单价</th>
                  <th className="px-3 py-2 font-medium">税率</th>
                  <th className="px-3 py-2 font-medium">净额</th>
                  <th className="px-3 py-2 font-medium">税额</th>
                  <th className="px-3 py-2 font-medium">来源</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {(detail.lines ?? []).map((line) => (
                  <tr key={line.id}>
                    <td className="px-3 py-2 text-ink-secondary">{line.lineNo}</td>
                    <td className="px-3 py-2 text-ink-primary">
                      {line.item ? `${line.item.code ?? ""} ${line.item.name ?? ""}`.trim() : "—"}
                    </td>
                    <td className="px-3 py-2 text-ink-primary">{line.quantity}</td>
                    <td className="px-3 py-2 text-ink-secondary">{line.unitPrice}</td>
                    <td className="px-3 py-2 text-ink-secondary">{line.taxRate}%</td>
                    <td className="px-3 py-2 text-ink-primary">{formatMoney(line.netAmount, detail.currency)}</td>
                    <td className="px-3 py-2 text-ink-secondary">{formatMoney(line.taxAmount, detail.currency)}</td>
                    <td className="px-3 py-2 text-ink-secondary">
                      {line.warehouseReceiptLine?.warehouseReceipt?.code
                        ? `入库 ${line.warehouseReceiptLine.warehouseReceipt.code}`
                        : line.purchaseOrderLine
                          ? `PO L${line.purchaseOrderLine.lineNo}`
                          : "—"}
                    </td>
                  </tr>
                ))}
                {(detail.lines ?? []).length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-sm text-ink-muted">暂无明细行</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </EntityDetailWorkspace>

      <ConfirmActionDialog
        open={confirmAction !== null}
        title={
          confirmAction === "submit" ? "提交供应商发票" : confirmAction === "match" ? "三单匹配" : "过账（AP）"
        }
        description={
          confirmAction === "submit"
            ? "提交后进入三单匹配/审批流程（SUBMITTED ≠ POSTED）。确认提交？"
            : confirmAction === "match"
              ? "执行三单匹配（服务端快照 PO/入库/发票数量与价格差异），产生不可变匹配记录。确认？"
              : "过账将产生 GRIR CONSUME + AP 应付 + 应付未结项（同事务落账），不可逆。确认过账？"
        }
        confirmLabel={confirmAction === "post" ? "确认过账" : "确认"}
        tone={confirmAction === "post" ? "danger" : "primary"}
        busy={actionBusy}
        onConfirm={() => {
          const a = confirmAction;
          setConfirmAction(null);
          if (a) void runAction(a);
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("supplier-invoice", "view")}>
      <SupplierInvoiceDetailPage />
    </PermissionGuard>
  );
}
