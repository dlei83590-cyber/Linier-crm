"use client";

/**
 * Sales Invoice Detail — 销售发票详情页（F2-6A Sales Read Foundation + F2-6B 批 3 动作）
 *
 * 只读 Detail：AppPage → EntityDetailWorkspace（Header → Summary → Lines）。
 * F2-6B 批 3：状态 Gate + 权限 Gate 后提供：
 *  - 开具 issue（invoice:approve）：仅 DRAFT（后端仍有审批门禁，APPROVED 才可开票，409 兜底）
 *  - 取消 cancel（invoice:close）：仅 DRAFT（ISSUED+ 走 Credit Note）
 * 不提供 Edit 入口（invoice 编辑本轮不做）。
 * PermissionGuard 对齐 API requirePermission("invoice:view")。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import type { StatusTone } from "@/components/design-system";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, ConfirmActionDialog, EntityDetailWorkspace, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useToast } from "@/components/ui/toast";
import { PageLoading } from "@/components/ui/skeleton";
import { useSession } from "@/lib/session-context";
import { formatDate, formatMoney } from "@/lib/format";
import {
  INVOICE_TYPE_LABELS,
  INVOICE_TYPE_OPTIONS,
  formatTaxInvoiceNumber,
  validateIssueVatFields,
} from "@/lib/vat-labels";

const TONE_MAP: Record<string, StatusTone> = {
  DRAFT: "neutral",
  ISSUED: "info",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  CANCELLED: "danger",
};

/** 状态中文业务名（Business UX Rationalization：枚举展示中文，不展示数据库枚举值；key 保留真实 enum） */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  ISSUED: "已开票",
  PARTIALLY_PAID: "部分收款",
  PAID: "已收款",
  CANCELLED: "已取消",
};

interface InvoiceLine {
  id: string;
  lineNo: number;
  description?: string | null;
  quantity: string;
  unitPrice: string;
  totalAmount?: string;
  item?: { id: string; code: string | null; name: string | null; model?: string | null } | null;
}

interface InvoiceDetail {
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
  taxInvoiceCode?: string | null;
  taxInvoiceNo?: string | null;
  redLetter?: boolean;
  redInvoiceRefId?: string | null;
  remark?: string | null;
  customer?: { id: string; code: string | null; name: string | null } | null;
  delivery?: {
    id: string;
    code: string | null;
    status: string | null;
    deliveryDate?: string | null;
    salesOrder?: { id: string; code: string | null; status: string | null; currency: string | null } | null;
  } | null;
  lines?: InvoiceLine[];
  createdAt: string;
}

type ConfirmAction = "issue" | "cancel" | "delete-red" | "reverse-issue";

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
}

function InvoiceDetailPage() {
  const params = useParams();
  const { state } = useSession();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiClientError | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  // VAT 开票表单（ADR-0043）：发票类型默认普票；税务号码按类型校验；红字引用原票 ID
  const [issueForm, setIssueForm] = useState({
    invoiceType: "ORDINARY_VAT",
    taxInvoiceCode: "",
    taxInvoiceNo: "",
    redInvoiceRefId: "",
  });
  const [issueVatError, setIssueVatError] = useState<string | null>(null);
  const toast = useToast();

  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canApprove = hasPermission(roles, actionPermission("invoice", "approve"));
  const canClose = hasPermission(roles, actionPermission("invoice", "close"));
  const canCreate = hasPermission(roles, actionPermission("invoice", "create"));
  const canDelete = hasPermission(roles, actionPermission("invoice", "delete"));
  const isDraft = detail !== null && detail.status === "DRAFT";
  // 蓝票（ISSUED 且非红字）可红冲；红字草稿自动预填引用
  const isIssuedBlue = detail !== null && detail.status === "ISSUED" && !detail.redLetter;
  // 红字发票（redLetter）DRAFT/ISSUED/CANCELLED 可删除（ISSUED 删除 = 撤销红冲恢复应收；CANCELLED 直接删）
  const isRedDeletable =
    detail !== null && detail.redLetter === true && ["DRAFT", "ISSUED", "CANCELLED"].includes(detail.status);

  const loadDetail = async () => {
    try {
      const body = await apiFetch<InvoiceDetail>(`/api/invoices/${id}`);
      setDetail(body.data);
      // 红字草稿：自动沿用 DB 预填的 redInvoiceRefId（POST /red-invoice 创建时写入），
      // issue 时后端以 DB 引用为准（R2/R4/R6 校验），避免用户手动重填
      if (body.data.redInvoiceRefId) {
        setIssueForm((f) => ({ ...f, redInvoiceRefId: body.data.redInvoiceRefId ?? "" }));
      }
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "刷新失败", "NETWORK_ERROR"),
      );
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<InvoiceDetail>(`/api/invoices/${id}`, { signal: controller.signal })
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

  const runAction = async (action: ConfirmAction) => {
    if (!detail || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      if (action === "issue") {
        // VAT 校验（ADR-0043）：类型必填 + 号码格式（I4/I7）；红字引用非空时后端二次校验
        const vatErr = validateIssueVatFields(issueForm.invoiceType, issueForm.taxInvoiceCode, issueForm.taxInvoiceNo);
        if (vatErr) {
          setIssueVatError(vatErr);
          return;
        }
        setIssueVatError(null);
        await apiFetch(`/api/invoices/${id}/issue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            changeReason: "对外开票",
            invoiceType: issueForm.invoiceType,
            taxInvoiceCode: issueForm.taxInvoiceCode || null,
            taxInvoiceNo: issueForm.taxInvoiceNo || null,
            redInvoiceRefId: issueForm.redInvoiceRefId || null,
          }),
        });
      } else if (action === "cancel") {
        await apiFetch(`/api/invoices/${id}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ changeReason: "取消草稿发票" }),
        });
      } else if (action === "delete-red") {
        // delete-red：删除红字发票（ISSUED 删除 = 撤销红冲恢复应收）
        await apiFetch(`/api/invoices/${id}`, {
          method: "DELETE",
        });
      } else {
        // reverse-issue：反开票撤销（红冲 = 撤销错误开票）
        await apiFetch(`/api/invoices/${id}/reverse-issue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ changeReason: "反开票（撤销错误开票）" }),
        });
      }
      await loadDetail();
      toast.success(
        action === "issue"
          ? "开票成功"
          : action === "cancel"
            ? "发票已取消"
            : action === "delete-red"
              ? "红字发票已删除"
              : "已反开票撤销（原票作废、应收清除、开票数量释放）",
      );
    } catch (err: unknown) {
      toast.error("操作失败", err instanceof ApiClientError ? err.message : "网络错误");
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
        <div className="border-border bg-surface overflow-hidden rounded-lg border">
          <PageLoading rows={5} />
        </div>
      </AppPage>
    );
  }

  if (error || !detail) {
    return (
      <AppPage>
        <ErrorPanel error={error} />
        <Link href="/sales/invoices" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
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
        title={`销售发票详情 — ${detail.code ?? "（草稿）"}`}
        backHref="/sales/invoices"
        status={detail.status}
        statusLabel={STATUS_LABELS[detail.status] ?? detail.status}
        statusTone={TONE_MAP[detail.status] ?? "neutral"}
        actions={
          (isDraft && (canApprove || canClose)) || (isIssuedBlue && canCreate) || (isRedDeletable && canDelete) ? (
            <>
              {isDraft && canApprove && (
                <button
                  type="button"
                  onClick={() => setConfirmAction("issue")}
                  disabled={actionBusy}
                  className={BUTTON_PRIMARY_CLASS}
                >
                  {actionBusy ? "处理中…" : "开具发票"}
                </button>
              )}
              {isDraft && canClose && (
                <button
                  type="button"
                  onClick={() => setConfirmAction("cancel")}
                  disabled={actionBusy}
                  className="rounded-md border border-status-danger-border bg-surface px-3 py-1.5 text-sm font-medium text-status-danger-text hover:bg-status-danger-bg disabled:cursor-not-allowed disabled:opacity-50"
                >
                  取消
                </button>
              )}
              {isIssuedBlue && canCreate && (
                <button
                  type="button"
                  onClick={() => setConfirmAction("reverse-issue")}
                  disabled={actionBusy}
                  className="rounded-md border border-status-danger-border bg-surface px-3 py-1.5 text-sm font-medium text-status-danger-text hover:bg-status-danger-bg disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {actionBusy ? "处理中…" : "红冲（撤销开票）"}
                </button>
              )}
              {isRedDeletable && canDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmAction("delete-red")}
                  disabled={actionBusy}
                  className="rounded-md border border-status-danger-border bg-surface px-3 py-1.5 text-sm font-medium text-status-danger-text hover:bg-status-danger-bg disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {actionBusy ? "处理中…" : "删除红字发票"}
                </button>
              )}
            </>
          ) : undefined
        }
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="单号" value={detail.code ?? "（草稿）"} />
            <InfoItem label="客户" value={detail.customer?.name} />
            <InfoItem
              label="来源送货单"
              value={
                detail.delivery ? (
                  <Link
                    href={`/sales/deliveries/${detail.delivery.id}`}
                    className="text-brand-600 hover:underline"
                  >
                    {detail.delivery.code}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            <InfoItem label="开票日期" value={formatDate(detail.invoiceDate)} />
            <InfoItem label="到期日" value={formatDate(detail.dueDate)} />
            <InfoItem label="币种" value={detail.currency} />
            <InfoItem
              label="发票类型"
              value={
                detail.invoiceType ? (
                  <span className="inline-flex items-center gap-1">
                    {INVOICE_TYPE_LABELS[detail.invoiceType] ?? detail.invoiceType}
                    {detail.redLetter ? (
                      <span className="rounded bg-status-danger-bg/20 px-1 py-0.5 text-xs text-status-danger-text">红字</span>
                    ) : null}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <InfoItem
              label="税务发票号码"
              value={formatTaxInvoiceNumber(detail.taxInvoiceCode, detail.taxInvoiceNo)}
            />
            <InfoItem label="含税合计" value={formatMoney(detail.invoiceTotal, detail.currency)} />
            <InfoItem label="已收款" value={formatMoney(detail.paidAmount, detail.currency)} />
            <InfoItem label="应收余额" value={formatMoney(detail.balanceAmount, detail.currency)} />
            <InfoItem label="备注" value={detail.remark} />
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
          </div>
        }
      >
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">
            明细行（{detail.lines?.length ?? 0}）
          </h2>
          <div className="overflow-x-auto">
            <table className="divide-border min-w-full divide-y text-sm">
              <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">行号</th>
                  <th className="px-3 py-2 font-medium">物料</th>
                  <th className="px-3 py-2 font-medium">描述</th>
                  <th className="px-3 py-2 text-right font-medium">数量</th>
                  <th className="px-3 py-2 text-right font-medium">单价</th>
                  <th className="px-3 py-2 text-right font-medium">金额</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {(detail.lines ?? []).map((line) => (
                  <tr key={line.id}>
                    <td className="px-3 py-2 text-ink-secondary">{line.lineNo}</td>
                    <td className="px-3 py-2 text-ink-primary">
                      {line.item ? `${line.item.code ?? ""} ${line.item.name ?? ""}`.trim() : "—"}
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{line.description}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-primary">
                      {line.quantity}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                      {formatMoney(line.unitPrice, detail.currency)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-primary">
                      {formatMoney(line.totalAmount ?? "0", detail.currency)}
                    </td>
                  </tr>
                ))}
                {(detail.lines ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-sm text-ink-muted">
                      暂无明细行
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </EntityDetailWorkspace>

      {/* VAT 开票表单（ADR-0043）：类型 + 税务号码 + 红字引用 */}
      {confirmAction === "issue" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="border-border bg-surface w-full max-w-md rounded-lg border p-5 shadow-lg">
            <h3 className="text-ink-primary text-base font-semibold">开具发票（VAT）</h3>
            <p className="text-ink-muted mt-1 text-xs">
              开具后生成正式编号（ISSUED），不可撤销；开票资料缺失时后端会拒绝。
            </p>
            {issueVatError && (
              <div className="border-status-danger-border mt-3 rounded-md border bg-status-danger-bg/10 p-2 text-xs text-status-danger-text">
                {issueVatError}
              </div>
            )}
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-ink-secondary text-xs">发票类型 *</label>
                <select
                  value={issueForm.invoiceType}
                  onChange={(e) =>
                    setIssueForm((f) => ({ ...f, invoiceType: e.target.value, taxInvoiceCode: "", taxInvoiceNo: "" }))
                  }
                  className={SELECT_CLASS + " mt-1 w-full"}
                >
                  {INVOICE_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className="text-ink-muted mt-1 text-xs">
                  {issueForm.invoiceType === "SPECIAL_VAT"
                    ? "一般纳税人客户请选专票（需完整开票资料）"
                    : "默认普票；数电票填 20 位号码"}
                </p>
              </div>
              {issueForm.invoiceType !== "EXPORT" && issueForm.invoiceType !== "OTHER" && (
                <>
                  {issueForm.invoiceType !== "ELECTRONIC_VAT" && (
                    <div>
                      <label className="text-ink-secondary text-xs">发票代码（12 位）</label>
                      <input
                        value={issueForm.taxInvoiceCode}
                        onChange={(e) => setIssueForm((f) => ({ ...f, taxInvoiceCode: e.target.value.replace(/\D/g, "") }))}
                        placeholder="12 位数字"
                        maxLength={12}
                        className={SELECT_CLASS + " mt-1 w-full"}
                      />
                    </div>
                  )}
                  <div>
                    <label className="text-ink-secondary text-xs">
                      发票号码（{issueForm.invoiceType === "ELECTRONIC_VAT" ? "20 位" : "8 位"}）
                    </label>
                    <input
                      value={issueForm.taxInvoiceNo}
                      onChange={(e) => setIssueForm((f) => ({ ...f, taxInvoiceNo: e.target.value.replace(/\D/g, "") }))}
                      placeholder={issueForm.invoiceType === "ELECTRONIC_VAT" ? "20 位数字" : "8 位数字"}
                      maxLength={issueForm.invoiceType === "ELECTRONIC_VAT" ? 20 : 8}
                      className={SELECT_CLASS + " mt-1 w-full"}
                    />
                  </div>
                </>
              )}
              <div>
                <label className="text-ink-secondary text-xs">红字引用原票 ID（可选）</label>
                <input
                  value={issueForm.redInvoiceRefId}
                  onChange={(e) => setIssueForm((f) => ({ ...f, redInvoiceRefId: e.target.value }))}
                  placeholder="填原蓝字发票 ID 则按红字开具（金额服务端取反）"
                  className={SELECT_CLASS + " mt-1 w-full"}
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmAction(null);
                  setIssueVatError(null);
                }}
                disabled={actionBusy}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink-primary hover:bg-canvas"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void runAction("issue")}
                disabled={actionBusy}
                className={BUTTON_PRIMARY_CLASS}
              >
                {actionBusy ? "开具中…" : "确认开具"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmActionDialog
        open={confirmAction === "cancel"}
        title="取消发票"
        description="取消该草稿发票？取消后释放送货单已占用的开票数量（ISSUED 后禁止直接取消，需走贷项通知单）。"
        confirmLabel="确认取消"
        tone="danger"
        busy={actionBusy}
        onConfirm={() => {
          setConfirmAction(null);
          void runAction("cancel");
        }}
        onCancel={() => setConfirmAction(null)}
      />

      <ConfirmActionDialog
        open={confirmAction === "delete-red"}
        title="删除红字发票"
        description={
          detail?.status === "ISSUED"
            ? "删除已开票红字发票 = 撤销红冲：将恢复原票应收账款余额（原票应收回到红冲前）。确定删除？"
            : "删除红字发票草稿（未生效，无应收影响）。确定删除？"
        }
        confirmLabel="确认删除"
        tone="danger"
        busy={actionBusy}
        onConfirm={() => {
          setConfirmAction(null);
          void runAction("delete-red");
        }}
        onCancel={() => setConfirmAction(null)}
      />

      <ConfirmActionDialog
        open={confirmAction === "reverse-issue"}
        title="红冲（撤销开票）"
        description="反开票撤销该已开票发票？将作废原票（CANCELLED）、清除应收、释放送货单开票数量（可重新开票）。仅未收款发票可撤销；有收款请先冲销核销。"
        confirmLabel="确认撤销"
        tone="danger"
        busy={actionBusy}
        onConfirm={() => {
          setConfirmAction(null);
          void runAction("reverse-issue");
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("invoice", "view")}>
      <InvoiceDetailPage />
    </PermissionGuard>
  );
}