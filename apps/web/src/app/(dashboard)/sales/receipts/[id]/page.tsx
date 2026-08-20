"use client";

/**
 * Receipt Detail — 收款单详情页（F2-6B 批 2）
 *
 * 只读 Detail + 事实动作：AppPage → EntityDetailWorkspace（Header → Summary → Allocations）。
 * 动作（状态 Gate + 权限 Gate，忠实表达后端状态机，不发明业务状态）：
 *  - 核销 allocate（receipt:edit）：UNALLOCATED / PARTIALLY_ALLOCATED 且 unallocatedAmount > 0；
 *    打开 source-selection dialog 选择应收未结项逐笔核销。
 *  - 作废 void（receipt:close）：仅 UNALLOCATED 可作废（已有核销须先冲销）。
 *  - 冲销 reverse（receipt:edit）：对未冲销的核销记录撤销（独立逆向事实）。
 * 消费 FINAL 契约：GET /api/receipts/{id}、POST /allocate、POST /void、POST /api/receipt-allocations/{id}/reverse。
 * PermissionGuard 对齐 API requirePermission("receipt:view")。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import type { StatusTone } from "@/components/design-system";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityDetailWorkspace, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { useSession } from "@/lib/session-context";
import { formatDate, formatMoney } from "@/lib/format";

const STATUS_LABEL: Record<string, string> = {
  UNALLOCATED: "未核销",
  PARTIALLY_ALLOCATED: "部分核销",
  FULLY_ALLOCATED: "已核销",
  VOIDED: "已作废",
};

const TONE_MAP: Record<string, StatusTone> = {
  UNALLOCATED: "info",
  PARTIALLY_ALLOCATED: "warning",
  FULLY_ALLOCATED: "success",
  VOIDED: "danger",
};

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  BANK_TRANSFER: "银行转账",
  CHEQUE: "支票",
  CASH: "现金",
  CARD: "刷卡",
  BANK_ACCEPTANCE_BILL: "银行承兑汇票",
  COMMERCIAL_ACCEPTANCE_BILL: "商业承兑汇票",
  TT_ELECTRONIC_TRANSFER: "电汇",
  OTHER: "其他",
};

interface ReceiptAllocation {
  id: string;
  allocatedAmount: string;
  allocatedAt: string;
  reversedAt?: string | null;
  accountsReceivable?: {
    id: string;
    invoiceId: string;
    balanceAmount: string;
    status: string;
  } | null;
}

interface ReceiptDetail {
  id: string;
  code: string;
  status: string;
  amount: string;
  allocatedAmount: string;
  unallocatedAmount: string;
  receiptDate: string;
  currency: string;
  paymentMethod?: string | null;
  referenceNo?: string | null;
  voidedAt?: string | null;
  createdAt: string;
  customer?: { id: string; code: string | null; name: string | null } | null;
  allocations?: ReceiptAllocation[];
}

interface ArOption {
  id: string;
  invoiceId: string;
  balanceAmount: string;
  status: string;
  invoice?: { id: string; code: string | null; status: string | null } | null;
}

/** allocate dialog 选择状态：AR id → 是否勾选 + 核销金额 */
interface AllocateSelection {
  checked: boolean;
  amount: string;
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
}

function ReceiptDetailPage() {
  const params = useParams();
  const { state } = useSession();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<ReceiptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiClientError | null>(null);

  // allocate dialog
  const [allocateOpen, setAllocateOpen] = useState(false);
  const [arOptions, setArOptions] = useState<ArOption[]>([]);
  const [arLoading, setArLoading] = useState(false);
  const [selections, setSelections] = useState<Record<string, AllocateSelection>>({});
  const [dialogError, setDialogError] = useState<string | null>(null);

  // void confirm
  const [voidOpen, setVoidOpen] = useState(false);

  // reverse dialog
  const [reverseTarget, setReverseTarget] = useState<ReceiptAllocation | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reverseError, setReverseError] = useState<string | null>(null);

  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canEdit = hasPermission(roles, actionPermission("receipt", "edit"));
  const canClose = hasPermission(roles, actionPermission("receipt", "close"));

  const canAllocate =
    detail !== null &&
    detail.status !== "VOIDED" &&
    Number(detail.unallocatedAmount) > 0;
  const canVoid = detail !== null && detail.status === "UNALLOCATED";

  const loadDetail = () => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<ReceiptDetail>(`/api/receipts/${id}`, { signal: controller.signal })
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
    return controller;
  };

  useEffect(() => {
    const controller = loadDetail();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const refreshDetail = async () => {
    try {
      const body = await apiFetch<ReceiptDetail>(`/api/receipts/${id}`);
      setDetail(body.data);
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "刷新失败", "NETWORK_ERROR"),
      );
    }
  };

  // ── 打开 allocate dialog：拉取该客户正余额应收未结项 ──
  const openAllocateDialog = async () => {
    if (!detail) return;
    setAllocateOpen(true);
    setDialogError(null);
    setArLoading(true);
    try {
      const body = await apiFetch<ArOption[]>(
        `/api/accounts-receivables?customerId=${encodeURIComponent(detail.customer?.id ?? "")}&pageSize=100`,
      );
      // 仅展示正余额（balanceAmount > 0）的应收——负余额（Customer Credit）后端禁核销
      const openArs = (body.data ?? []).filter((ar) => Number(ar.balanceAmount) > 0);
      setArOptions(openArs);
      const next: Record<string, AllocateSelection> = {};
      for (const ar of openArs) {
        next[ar.id] = { checked: false, amount: String(ar.balanceAmount) };
      }
      setSelections(next);
    } catch (err: unknown) {
      setDialogError(
        err instanceof ApiClientError ? `${describeStatus(err.status)}：${err.message}` : "加载应收未结项失败",
      );
    } finally {
      setArLoading(false);
    }
  };

  const closeAllocateDialog = () => {
    setAllocateOpen(false);
    setDialogError(null);
  };

  const updateSelection = (arId: string, patch: Partial<AllocateSelection>) => {
    setSelections((prev) => ({ ...prev, [arId]: { ...prev[arId], ...patch } }));
  };

  // ── 核销 submit：校验后才 POST（后端锁内校验 amount ≤ balanceAmount / Σ ≤ unallocatedAmount） ──
  const handleAllocate = async () => {
    if (!detail || actionBusy) return;
    const selected = arOptions.filter((ar) => selections[ar.id]?.checked);
    if (selected.length === 0) {
      setDialogError("请至少选择一笔应收");
      return;
    }
    for (const ar of selected) {
      const amt = Number(selections[ar.id].amount);
      if (!selections[ar.id].amount || !(amt > 0)) {
        setDialogError(`应收 ${ar.invoice?.code ?? ar.id}：核销金额必须大于 0`);
        return;
      }
      if (amt > Number(ar.balanceAmount)) {
        setDialogError(`应收 ${ar.invoice?.code ?? ar.id}：核销金额不能超过应收余额 ${ar.balanceAmount}`);
        return;
      }
    }
    setActionBusy(true);
    setActionError(null);
    setDialogError(null);
    try {
      await apiFetch(`/api/receipts/${id}/allocate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allocations: selected.map((ar) => ({
            accountsReceivableId: ar.id,
            amount: Number(selections[ar.id].amount),
          })),
          changeReason: "核销收款",
        }),
      });
      closeAllocateDialog();
      await refreshDetail();
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "核销失败", "NETWORK_ERROR"),
      );
      setDialogError(null);
    } finally {
      setActionBusy(false);
    }
  };

  // ── 作废（仅 UNALLOCATED） ──
  const handleVoid = async () => {
    if (!detail || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    setVoidOpen(false);
    try {
      await apiFetch(`/api/receipts/${id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changeReason: "作废收款单" }),
      });
      await refreshDetail();
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "作废失败", "NETWORK_ERROR"),
      );
    } finally {
      setActionBusy(false);
    }
  };

  // ── 冲销核销记录 ──
  const handleReverse = async () => {
    if (!reverseTarget || actionBusy) return;
    if (!reverseReason.trim()) {
      setReverseError("请填写冲销原因");
      return;
    }
    setActionBusy(true);
    setActionError(null);
    setReverseError(null);
    try {
      await apiFetch(`/api/receipt-allocations/${reverseTarget.id}/reverse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reverseReason: reverseReason.trim() }),
      });
      setReverseTarget(null);
      setReverseReason("");
      await refreshDetail();
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "冲销失败", "NETWORK_ERROR"),
      );
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) {
    return (
      <AppPage>
        <div className="border-border bg-surface rounded-lg border p-6 text-sm text-ink-muted">
          加载中…
        </div>
      </AppPage>
    );
  }

  if (error || !detail) {
    return (
      <AppPage>
        <ErrorPanel error={error} />
        <Link href="/sales/receipts" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
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
        title={`收款单详情 — ${detail.code}`}
        backHref="/sales/receipts"
        status={detail.status}
        statusLabel={STATUS_LABEL[detail.status] ?? detail.status}
        statusTone={TONE_MAP[detail.status] ?? "neutral"}
        actions={
          (canAllocate && canEdit) || (canVoid && canClose) ? (
            <>
              {canAllocate && canEdit && (
                <button
                  type="button"
                  onClick={openAllocateDialog}
                  disabled={actionBusy}
                  className={BUTTON_PRIMARY_CLASS}
                >
                  {actionBusy ? "处理中…" : "核销"}
                </button>
              )}
              {canVoid && canClose && (
                <button
                  type="button"
                  onClick={() => setVoidOpen(true)}
                  disabled={actionBusy}
                  className="rounded-md border border-status-danger-border bg-surface px-3 py-1.5 text-sm font-medium text-status-danger-text hover:bg-status-danger-bg disabled:cursor-not-allowed disabled:opacity-50"
                >
                  作废
                </button>
              )}
            </>
          ) : undefined
        }
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="单号" value={detail.code} />
            <InfoItem label="客户" value={detail.customer?.name} />
            <InfoItem label="收款日期" value={formatDate(detail.receiptDate)} />
            <InfoItem label="收款方式" value={PAYMENT_METHOD_LABEL[detail.paymentMethod ?? ""] ?? detail.paymentMethod} />
            <InfoItem label="币种" value={detail.currency} />
            <InfoItem label="收款金额" value={formatMoney(detail.amount, detail.currency)} />
            <InfoItem label="已核销" value={formatMoney(detail.allocatedAmount, detail.currency)} />
            <InfoItem label="未核销" value={formatMoney(detail.unallocatedAmount, detail.currency)} />
            <InfoItem label="参考号" value={detail.referenceNo} />
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
            {detail.voidedAt && <InfoItem label="作废时间" value={formatDate(detail.voidedAt)} />}
          </div>
        }
      >
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">
            核销记录（{detail.allocations?.length ?? 0}）
          </h2>
          <div className="overflow-x-auto">
            <table className="divide-border min-w-full divide-y text-sm">
              <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">核销金额</th>
                  <th className="px-3 py-2 font-medium">应收（AR）</th>
                  <th className="px-3 py-2 font-medium">核销时间</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {(detail.allocations ?? []).map((alloc) => (
                  <tr key={alloc.id}>
                    <td className="px-3 py-2 text-ink-primary">
                      {formatMoney(alloc.allocatedAmount, detail.currency)}
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">
                      {alloc.accountsReceivable ? `AR ${alloc.accountsReceivable.id.slice(0, 8)}…` : "—"}
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{formatDate(alloc.allocatedAt)}</td>
                    <td className="px-3 py-2 text-ink-secondary">
                      {alloc.reversedAt ? "已冲销" : "有效"}
                    </td>
                    <td className="px-3 py-2">
                      {!alloc.reversedAt && canEdit && (
                        <button
                          type="button"
                          onClick={() => {
                            setReverseTarget(alloc);
                            setReverseReason("");
                            setReverseError(null);
                          }}
                          disabled={actionBusy}
                          className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          冲销
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {(detail.allocations ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-sm text-ink-muted">
                      暂无核销记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </EntityDetailWorkspace>

      {/* ── 作废确认对话框 ── */}
      {voidOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setVoidOpen(false)}
        >
          <div
            className="border-border bg-surface shadow-elevation-lg w-full max-w-md rounded-lg border p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-ink-primary text-base font-semibold">作废收款单</h2>
            <p className="text-ink-secondary mt-2 text-sm">
              确认作废该收款单？作废后不可核销，且不可恢复（仅未核销收款单可作废）。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setVoidOpen(false)}
                disabled={actionBusy}
                className="border-border text-ink-secondary rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleVoid}
                disabled={actionBusy}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionBusy ? "处理中…" : "确认作废"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 核销：source-selection dialog ── */}
      {allocateOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={closeAllocateDialog}
        >
          <div
            className="border-border bg-surface shadow-elevation-lg flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-border flex items-center justify-between border-b px-5 py-3">
              <h2 className="text-ink-primary text-base font-semibold">核销 — 选择应收未结项</h2>
              <span className="text-ink-muted text-xs">剩余可核销 {detail.unallocatedAmount}</span>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              <p className="text-ink-muted mb-3 text-xs">
                勾选要核销的应收并填写金额（默认应收余额，可改小）；至少选择一笔。金额最终由后端锁内校验。
              </p>
              {dialogError && (
                <div className="border-status-danger-border mb-3 rounded-md border bg-status-danger-bg p-2 text-sm text-status-danger-text">
                  {dialogError}
                </div>
              )}
              {arLoading ? (
                <p className="text-ink-muted py-6 text-center text-sm">加载应收未结项…</p>
              ) : (
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
                    <tr>
                      <th className="px-3 py-2">选择</th>
                      <th className="px-3 py-2">发票</th>
                      <th className="px-3 py-2">应收余额</th>
                      <th className="px-3 py-2">状态</th>
                      <th className="px-3 py-2">本次核销</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {arOptions.map((ar) => {
                      const sel = selections[ar.id];
                      return (
                        <tr key={ar.id} className={sel?.checked ? "" : "opacity-50"}>
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={sel?.checked ?? false}
                              onChange={(e) => updateSelection(ar.id, { checked: e.target.checked })}
                              className="h-4 w-4 accent-brand-600"
                            />
                          </td>
                          <td className="px-3 py-2 text-ink-secondary">{ar.invoice?.code ?? ar.invoiceId}</td>
                          <td className="px-3 py-2 text-ink-secondary">{ar.balanceAmount}</td>
                          <td className="px-3 py-2 text-ink-secondary">{ar.status}</td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={sel?.amount ?? ""}
                              disabled={!sel?.checked}
                              onChange={(e) => updateSelection(ar.id, { amount: e.target.value })}
                              className="focus:border-brand-500 w-28 rounded-md border border-border px-2 py-1.5 disabled:bg-canvas disabled:text-ink-muted"
                            />
                          </td>
                        </tr>
                      );
                    })}
                    {arOptions.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-8 text-center text-sm text-ink-muted">
                          该客户无正余额应收未结项
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>

            <div className="border-border flex justify-end gap-2 border-t px-5 py-3">
              <button
                type="button"
                onClick={closeAllocateDialog}
                disabled={actionBusy}
                className={BUTTON_SECONDARY_CLASS}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleAllocate}
                disabled={actionBusy || arLoading}
                className={BUTTON_PRIMARY_CLASS}
              >
                {actionBusy ? "核销中…" : "确认核销"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 冲销核销记录对话框 ── */}
      {reverseTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setReverseTarget(null)}
        >
          <div
            className="border-border bg-surface shadow-elevation-lg w-full max-w-md rounded-lg border p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-ink-primary text-base font-semibold">冲销核销记录</h2>
            <p className="text-ink-secondary mt-2 text-sm">
              将撤销这笔 {formatMoney(reverseTarget.allocatedAmount, detail.currency)} 的核销（保留逆向留痕）。
            </p>
            {reverseError && (
              <div className="border-status-danger-border mt-3 rounded-md border bg-status-danger-bg p-2 text-sm text-status-danger-text">
                {reverseError}
              </div>
            )}
            <label className="mt-4 block text-xs text-ink-secondary">冲销原因 *</label>
            <input
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
              maxLength={500}
              placeholder="请填写冲销原因"
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReverseTarget(null)}
                disabled={actionBusy}
                className="border-border text-ink-secondary rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleReverse}
                disabled={actionBusy}
                className={BUTTON_PRIMARY_CLASS}
              >
                {actionBusy ? "冲销中…" : "确认冲销"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("receipt", "view")}>
      <ReceiptDetailPage />
    </PermissionGuard>
  );
}