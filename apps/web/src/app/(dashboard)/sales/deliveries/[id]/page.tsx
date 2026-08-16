"use client";

/**
 * Delivery Detail — 送货单详情页（F2-6A Sales Read Foundation + F2-6B 批 1 动作）
 *
 * 只读 Detail：AppPage → EntityDetailWorkspace（Header → Summary → Lines）。
 * F2-6B 批 1：状态 Gate + 权限 Gate 后提供 Create Invoice（invoice:create）动作。
 * 按 CTO REQUEST CHANGES（93/100 Blocking ①）修复：
 * 不再“一键全量”POST——点击按钮打开 source-selection dialog：
 * 仅列出 remainingInvoiceQty > 0 的行；每行 checkbox + quantity（默认剩余可开票量，可改小）；
 * 至少选择一行；不允许 > remaining；不前端计算金额；submit 后才 POST
 * （后端逐行校验 quantity <= remainingInvoiceQty，Partial Billing 支持）。
 * dispatch/confirm-delivery 等其它 factActions 仍不开放；不提供 Edit 入口。
 * PermissionGuard 对齐 API requirePermission("delivery:view")。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import type { StatusTone } from "@/components/design-system";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityDetailWorkspace, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { useSession } from "@/lib/session-context";
import { formatDate } from "@/lib/format";

const TONE_MAP: Record<string, StatusTone> = {
  DRAFT: "neutral",
  READY: "info",
  DISPATCHED: "info",
  DELIVERED: "success",
  COMPLETED: "success",
  CANCELLED: "danger",
};

interface DeliveryLine {
  id: string;
  lineNo: number;
  quantity: string;
  remainingInvoiceQty?: string;
  item?: { id: string; code: string | null; name: string | null; model?: string | null } | null;
  uom?: { id: string; code: string | null; name: string | null } | null;
  sourceSalesOrderLine?: { id: string; lineNo: number; quantity: string } | null;
}

interface InvoiceCreatedResponse {
  invoice: { id: string; code: string | null; status: string };
  lineCount: number;
}

interface DeliveryDetail {
  id: string;
  code: string;
  status: string;
  deliveryDate: string;
  remark?: string | null;
  customer?: { id: string; code: string | null; name: string | null } | null;
  salesOrder?: { id: string; code: string | null; status: string | null } | null;
  lines?: DeliveryLine[];
  createdAt: string;
}

/** dialog 选择状态：行 id → 是否勾选 + 开票数量 */
interface InvoiceSelection {
  checked: boolean;
  quantity: string;
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
}

function DeliveryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { state } = useSession();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<DeliveryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiClientError | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selections, setSelections] = useState<Record<string, InvoiceSelection>>({});
  const [dialogError, setDialogError] = useState<string | null>(null);

  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canCreateInvoice = hasPermission(roles, actionPermission("invoice", "create"));
  const canInvoice = detail !== null && detail.status === "DELIVERED";
  const invoicableLines = (detail?.lines ?? []).filter(
    (l) => Number(l.remainingInvoiceQty ?? l.quantity) > 0,
  );

  // ── 打开 dialog：默认全部可开票行勾选、数量 = remainingInvoiceQty（可改小） ──
  const openInvoiceDialog = () => {
    if (invoicableLines.length === 0) return;
    const next: Record<string, InvoiceSelection> = {};
    for (const l of invoicableLines) {
      next[l.id] = { checked: true, quantity: String(l.remainingInvoiceQty ?? l.quantity) };
    }
    setSelections(next);
    setDialogError(null);
    setDialogOpen(true);
  };

  const closeInvoiceDialog = () => {
    setDialogOpen(false);
    setDialogError(null);
  };

  const updateSelection = (lineId: string, patch: Partial<InvoiceSelection>) => {
    setSelections((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));
  };

  // ── submit：校验（至少一行；每行 quantity > 0 且 <= 剩余可开票量）后才 POST ──
  const handleCreateInvoice = async () => {
    if (!detail || actionBusy) return;
    const selected = invoicableLines.filter((l) => selections[l.id]?.checked);
    if (selected.length === 0) {
      setDialogError("请至少选择一行");
      return;
    }
    for (const l of selected) {
      const qty = Number(selections[l.id].quantity);
      const max = Number(l.remainingInvoiceQty ?? l.quantity);
      if (!selections[l.id].quantity || !(qty > 0)) {
        setDialogError(`第 ${l.lineNo} 行：开票数量必须大于 0`);
        return;
      }
      if (qty > max) {
        setDialogError(`第 ${l.lineNo} 行：开票数量不能超过剩余可开票量 ${max}`);
        return;
      }
    }
    setActionBusy(true);
    setActionError(null);
    setDialogError(null);
    try {
      const body = await apiFetch<InvoiceCreatedResponse>(`/api/deliveries/${id}/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: selected.map((l) => ({
            deliveryLineId: l.id,
            quantity: Number(selections[l.id].quantity),
          })),
          changeReason: "从送货单创建发票",
        }),
      });
      closeInvoiceDialog();
      router.push(`/sales/invoices/${body.data.invoice.id}`);
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "创建发票失败", "NETWORK_ERROR"),
      );
      setActionBusy(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<DeliveryDetail>(`/api/deliveries/${id}`, { signal: controller.signal })
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
        <Link href="/sales/deliveries" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
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
        title={`送货单详情 — ${detail.code}`}
        backHref="/sales/deliveries"
        status={detail.status}
        statusLabel={detail.status}
        statusTone={TONE_MAP[detail.status] ?? "neutral"}
        actions={
          canInvoice && canCreateInvoice ? (
            <button
              type="button"
              onClick={openInvoiceDialog}
              disabled={actionBusy || invoicableLines.length === 0}
              title={invoicableLines.length === 0 ? "无剩余可开票数量" : undefined}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {actionBusy ? "创建中…" : "创建发票"}
            </button>
          ) : undefined
        }
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="单号" value={detail.code} />
            <InfoItem label="客户" value={detail.customer?.name} />
            <InfoItem
              label="来源销售订单"
              value={
                detail.salesOrder ? (
                  <Link
                    href={`/sales/orders/${detail.salesOrder.id}`}
                    className="text-brand-600 hover:underline"
                  >
                    {detail.salesOrder.code}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            <InfoItem label="交付日期" value={formatDate(detail.deliveryDate)} />
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
              <thead className="bg-slate-50 text-left text-xs font-medium text-ink-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">行号</th>
                  <th className="px-3 py-2 font-medium">物料</th>
                  <th className="px-3 py-2 font-medium">数量</th>
                  <th className="px-3 py-2 font-medium">剩余可开票</th>
                  <th className="px-3 py-2 font-medium">单位</th>
                  <th className="px-3 py-2 font-medium">来源订单行</th>
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
                    <td className="px-3 py-2 text-ink-primary">
                      {line.remainingInvoiceQty ?? line.quantity}
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{line.uom?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">
                      {line.sourceSalesOrderLine
                        ? `L${line.sourceSalesOrderLine.lineNo} (${line.sourceSalesOrderLine.quantity})`
                        : "—"}
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

      {/* ── 创建发票：source-selection dialog（Partial Billing） ── */}
      {dialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={closeInvoiceDialog}
        >
          <div
            className="border-border bg-surface shadow-elevation-lg flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-border flex items-center justify-between border-b px-5 py-3">
              <h2 className="text-ink-primary text-base font-semibold">创建发票 — 选择开票行</h2>
              <span className="text-ink-muted text-xs">支持部分开票</span>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              <p className="text-ink-muted mb-3 text-xs">
                勾选要开票的行并填写数量（默认剩余可开票量，可改小）；至少选择一行。数量最终由后端锁内校验，金额由后端计算。
              </p>
              {dialogError && (
                <div className="border-red-200 mb-3 rounded-md border bg-red-50 p-2 text-sm text-red-700">
                  {dialogError}
                </div>
              )}
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-3 py-2">选择</th>
                    <th className="px-3 py-2">行号</th>
                    <th className="px-3 py-2">物料</th>
                    <th className="px-3 py-2">剩余可开票</th>
                    <th className="px-3 py-2">本次数量</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoicableLines.map((line) => {
                    const sel = selections[line.id];
                    const max = Number(line.remainingInvoiceQty ?? line.quantity);
                    return (
                      <tr key={line.id} className={sel?.checked ? "" : "opacity-50"}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={sel?.checked ?? false}
                            onChange={(e) =>
                              updateSelection(line.id, { checked: e.target.checked })
                            }
                            className="h-4 w-4 accent-brand-600"
                          />
                        </td>
                        <td className="px-3 py-2 text-slate-600">{line.lineNo}</td>
                        <td className="px-3 py-2 text-slate-700">
                          {line.item ? `${line.item.code ?? ""} ${line.item.name ?? ""}`.trim() : "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{max}</td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={sel?.quantity ?? ""}
                            disabled={!sel?.checked}
                            onChange={(e) =>
                              updateSelection(line.id, { quantity: e.target.value })
                            }
                            className="focus:border-brand-500 w-28 rounded-md border border-slate-200 px-2 py-1.5 disabled:bg-slate-50 disabled:text-slate-400"
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {invoicableLines.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-400">
                        无剩余可开票数量
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="border-border flex justify-end gap-2 border-t px-5 py-3">
              <button
                type="button"
                onClick={closeInvoiceDialog}
                disabled={actionBusy}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleCreateInvoice}
                disabled={actionBusy}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionBusy ? "创建中…" : "创建发票"}
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
    <PermissionGuard permission={actionPermission("delivery", "view")}>
      <DeliveryDetailPage />
    </PermissionGuard>
  );
}
