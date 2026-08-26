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
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, ConfirmActionDialog, EntityDetailWorkspace, ErrorPanel, StatusBadge } from "@/components/workspace";
import { PageLoading } from "@/components/ui/skeleton";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, INPUT_CLASS } from "@/lib/ui-classes";
import { salesStatusLabel, salesStatusTone } from "@/lib/sales-status";
import { useSession } from "@/lib/session-context";
import { formatDate, formatMoney } from "@/lib/format";

interface DeliveryLine {
  id: string;
  lineNo: number;
  quantity: string;
  remainingInvoiceQty?: string;
  item?: { id: string; code: string | null; name: string | null; model?: string | null } | null;
  uom?: { id: string; code: string | null; name: string | null } | null;
  sourceSalesOrderLine?: { id: string; lineNo: number; quantity: string } | null;
}

interface WarehouseOption {
  id: string;
  name: string | null;
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
  expectedArrivalDate?: string | null;
  carrier?: string | null;
  trackingNo?: string | null;
  podStatus?: string | null;
  podReceivedAt?: string | null;
  remark?: string | null;
  customer?: { id: string; code: string | null; name: string | null } | null;
  salesOrder?: { id: string; code: string | null; status: string | null } | null;
  lines?: DeliveryLine[];
  createdAt: string;
}

/** 本送货单已创建的发票（GET /api/invoices?deliveryId=…；FRT-06 下一单据链接） */
interface DeliveryInvoiceRef {
  id: string;
  code: string | null;
  status: string;
  invoiceDate: string;
  invoiceTotal: string;
  currency: string;
}

/** POD 签收状态中文标签 */
const POD_STATUS_LABELS: Record<string, string> = {
  PENDING: "待签收",
  RECEIVED: "已签收",
  WAIVED: "豁免签收",
};

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
  const [confirmAction, setConfirmAction] = useState<"ready" | "cancel" | "unconfirm" | "delete" | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchCarrier, setDispatchCarrier] = useState("");
  const [dispatchTrackingNo, setDispatchTrackingNo] = useState("");
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [dispatchWarehouseId, setDispatchWarehouseId] = useState("");
  const [confirmDeliverOpen, setConfirmDeliverOpen] = useState(false);
  const [podStatus, setPodStatus] = useState<"RECEIVED" | "WAIVED">("RECEIVED");
  // 相关发票（FRT-06：下一单据链接；独立 loading/error/retry，禁止把接口失败当空列表）
  const [invoices, setInvoices] = useState<DeliveryInvoiceRef[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [invoicesError, setInvoicesError] = useState<ApiClientError | null>(null);

  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canCreateInvoice = hasPermission(roles, actionPermission("invoice", "create"));
  const canViewInvoice = hasPermission(roles, actionPermission("invoice", "view"));
  const canEdit = hasPermission(roles, actionPermission("delivery", "edit"));
  const canApprove = hasPermission(roles, actionPermission("delivery", "approve"));
  const canClose = hasPermission(roles, actionPermission("delivery", "close"));
  const canDelete = hasPermission(roles, actionPermission("delivery", "delete"));
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

  const refreshDetail = async () => {
    try {
      const body = await apiFetch<DeliveryDetail>(`/api/deliveries/${id}`);
      setDetail(body.data);
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "刷新失败", "NETWORK_ERROR"),
      );
    }
  };

  // ── 就绪 / 取消 / 反签收 / 删除 ──
  const runAction = async (action: "ready" | "cancel" | "unconfirm" | "delete") => {
    if (!detail || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      if (action === "delete") {
        await apiFetch(`/api/deliveries/${id}`, {
          method: "DELETE",
        });
      } else {
        await apiFetch(`/api/deliveries/${id}/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            changeReason:
              action === "ready"
                ? "交付单就绪"
                : action === "cancel"
                  ? "取消交付单"
                  : "送货单反签收",
          }),
        });
      }
      await refreshDetail();
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "操作失败", "NETWORK_ERROR"),
      );
    } finally {
      setActionBusy(false);
    }
  };

  // ── 发运（READY → DISPATCHED，可补充承运方/运单号） ──
  const handleDispatch = async () => {
    if (!detail || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    setDispatchOpen(false);
    try {
      await apiFetch(`/api/deliveries/${id}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(dispatchCarrier.trim() ? { carrier: dispatchCarrier.trim() } : {}),
          ...(dispatchTrackingNo.trim() ? { trackingNo: dispatchTrackingNo.trim() } : {}),
          warehouseId: dispatchWarehouseId,
          changeReason: "交付单发运",
        }),
      });
      await refreshDetail();
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "发运失败", "NETWORK_ERROR"),
      );
    } finally {
      setActionBusy(false);
    }
  };

  // ── 确认收货（DISPATCHED → DELIVERED；POD 门禁 RECEIVED/WAIVED） ──
  const handleConfirmDelivery = async () => {
    if (!detail || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    setConfirmDeliverOpen(false);
    try {
      await apiFetch(`/api/deliveries/${id}/confirm-delivery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ podStatus, changeReason: "确认收货" }),
      });
      await refreshDetail();
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "确认收货失败", "NETWORK_ERROR"),
      );
    } finally {
      setActionBusy(false);
    }
  };

  // ── 相关发票（GET /api/invoices?deliveryId=…；只读，FRT-06 下一单据链接） ──
  const loadInvoices = useCallback((signal?: AbortSignal) => {
    setInvoicesLoading(true);
    setInvoicesError(null);
    apiFetch<DeliveryInvoiceRef[]>(`/api/invoices?deliveryId=${id}&pageSize=100`, { signal })
      .then((body) => setInvoices(body.data))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setInvoicesError(
          err instanceof ApiClientError ? err : new ApiClientError(0, "加载相关发票失败", "NETWORK_ERROR"),
        );
      })
      .finally(() => {
        if (!signal?.aborted) setInvoicesLoading(false);
      });
  }, [id]);

  const retryInvoices = () => loadInvoices();

  useEffect(() => {
    const ctrl = new AbortController();
    apiFetch<WarehouseOption[]>("/api/warehouses?pageSize=100&isActive=true", { signal: ctrl.signal })
      .then((b) => setWarehouses(b.data))
      .catch(() => setWarehouses([])); // best-effort：无 warehouse:view 权限时下拉为空，发运仍需选择仓库（后端校验）
    return () => ctrl.abort();
  }, []);

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
    if (canViewInvoice) {
      loadInvoices(controller.signal);
    } else {
      setInvoicesLoading(false);
    }
    return () => controller.abort();
  }, [id, loadInvoices, canViewInvoice, reloadKey]);

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
        <ErrorPanel error={error} onRetry={() => setReloadKey((k) => k + 1)} />
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
        statusLabel={salesStatusLabel("delivery", detail.status)}
        statusTone={salesStatusTone("delivery", detail.status)}
        actions={
          <>
            {detail.status === "DRAFT" && canEdit && (
              <Link
                href={`/sales/deliveries/${id}/edit`}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-primary hover:bg-canvas"
              >
                编辑
              </Link>
            )}
            {detail.status === "DRAFT" && canEdit && (
              <button
                type="button"
                onClick={() => setConfirmAction("ready")}
                disabled={actionBusy}
                className={BUTTON_PRIMARY_CLASS}
              >
                {actionBusy ? "处理中…" : "就绪"}
              </button>
            )}
            {detail.status === "READY" && canEdit && (
              <button
                type="button"
                onClick={() => {
                  setDispatchCarrier("");
                  setDispatchTrackingNo("");
                  setDispatchWarehouseId("");
                  setDispatchOpen(true);
                }}
                disabled={actionBusy}
                className={BUTTON_PRIMARY_CLASS}
              >
                {actionBusy ? "处理中…" : "发运"}
              </button>
            )}
            {detail.status === "DISPATCHED" && canApprove && (
              <button
                type="button"
                onClick={() => {
                  setPodStatus("RECEIVED");
                  setConfirmDeliverOpen(true);
                }}
                disabled={actionBusy}
                className={BUTTON_PRIMARY_CLASS}
              >
                {actionBusy ? "处理中…" : "确认收货"}
              </button>
            )}
            {(detail.status === "DRAFT" || detail.status === "READY") && canClose && (
              <button
                type="button"
                onClick={() => setConfirmAction("cancel")}
                disabled={actionBusy}
                className="rounded-md border border-status-danger-border bg-surface px-3 py-1.5 text-sm font-medium text-status-danger-text hover:bg-status-danger-bg disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
            )}
            {detail.status === "DELIVERED" && canApprove && (
              <button
                type="button"
                onClick={() => setConfirmAction("unconfirm")}
                disabled={actionBusy}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-primary hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionBusy ? "处理中…" : "反签收"}
              </button>
            )}
            {(detail.status === "CANCELLED" || detail.status === "DISPATCHED") && canDelete && (
              <button
                type="button"
                onClick={() => setConfirmAction("delete")}
                disabled={actionBusy}
                className="rounded-md border border-status-danger-border bg-surface px-3 py-1.5 text-sm font-medium text-status-danger-text hover:bg-status-danger-bg disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionBusy ? "处理中…" : "删除"}
              </button>
            )}
            {canInvoice && canCreateInvoice && (
              <button
                type="button"
                onClick={openInvoiceDialog}
                disabled={actionBusy || invoicableLines.length === 0}
                title={invoicableLines.length === 0 ? "无剩余可开票数量" : undefined}
                className={BUTTON_PRIMARY_CLASS}
              >
                {actionBusy ? "创建中…" : "创建发票"}
              </button>
            )}
          </>
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
            <InfoItem
              label="预计到达"
              value={detail.expectedArrivalDate ? formatDate(detail.expectedArrivalDate) : "—"}
            />
            <InfoItem label="承运方" value={detail.carrier ?? "—"} />
            <InfoItem label="运单号" value={detail.trackingNo ?? "—"} />
            <InfoItem
              label="签收状态（POD）"
              value={
                detail.podStatus ? (
                  <span>
                    {POD_STATUS_LABELS[detail.podStatus] ?? detail.podStatus}
                    {detail.podReceivedAt ? `（${formatDate(detail.podReceivedAt)}）` : ""}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <InfoItem label="备注" value={detail.remark} />
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
            <InfoItem
              label="库存出库"
              value={
                detail.status === "DISPATCHED" || detail.status === "DELIVERED" ? (
                  <span className="font-medium text-status-success-text">已出库（库存已扣减）</span>
                ) : (
                  <span className="text-ink-muted">未出库</span>
                )
              }
            />
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
                  <th className="px-3 py-2 text-right font-medium">数量</th>
                  <th className="px-3 py-2 text-right font-medium">剩余可开票</th>
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
                    <td className="px-3 py-2 text-right tabular-nums text-ink-primary">
                      {line.quantity}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-primary">
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

      {/* ── 相关发票（FRT-06：下一单据链接；独立 loading/error/retry；无 invoice:view 不展示） ── */}
      {canViewInvoice && (
      <section className="border-border bg-surface mt-4 rounded-lg border p-4">
        <h2 className="text-ink-primary mb-3 text-sm font-semibold">相关发票（{invoices.length}）</h2>
        {invoicesLoading ? (
          <p className="text-ink-muted text-xs">正在加载相关发票…</p>
        ) : invoicesError ? (
          <div role="alert" className="rounded-md border border-status-danger-border bg-status-danger-bg/10 p-3 text-sm text-status-danger-text">
            <p>
              {describeStatus(invoicesError.status)}：{invoicesError.message}
              {invoicesError.code ? `（${invoicesError.code}）` : ""}
            </p>
            <button
              type="button"
              onClick={retryInvoices}
              className="mt-2 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-canvas"
            >
              重试
            </button>
          </div>
        ) : invoices.length === 0 ? (
          <p className="text-ink-muted text-xs">暂无相关发票——确认收货（DELIVERED）后可从本页「创建发票」生成。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="divide-border min-w-full divide-y text-sm">
              <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">发票号</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">开票日期</th>
                  <th className="px-3 py-2 text-right font-medium">含税金额</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="px-3 py-2">
                      <Link
                        href={`/sales/invoices/${inv.id}`}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        {inv.code ?? "（草稿）"}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge
                        status={inv.status}
                        label={salesStatusLabel("invoice", inv.status)}
                        tone={salesStatusTone("invoice", inv.status)}
                      />
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{formatDate(inv.invoiceDate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-primary">
                      {formatMoney(inv.invoiceTotal, inv.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}

      {/* ── 创建发票：source-selection dialog（Partial Billing） ── */}
      {dialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
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
                <div className="border-status-danger-border mb-3 rounded-md border bg-status-danger-bg p-2 text-sm text-status-danger-text">
                  {dialogError}
                </div>
              )}
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
                  <tr>
                    <th className="px-3 py-2">选择</th>
                    <th className="px-3 py-2">行号</th>
                    <th className="px-3 py-2">物料</th>
                    <th className="px-3 py-2">剩余可开票</th>
                    <th className="px-3 py-2">本次数量</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
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
                        <td className="px-3 py-2 text-ink-secondary">{line.lineNo}</td>
                        <td className="px-3 py-2 text-ink-secondary">
                          {line.item ? `${line.item.code ?? ""} ${line.item.name ?? ""}`.trim() : "—"}
                        </td>
                        <td className="px-3 py-2 text-ink-secondary">{max}</td>
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
                            className="focus:border-brand-500 w-28 rounded-md border border-border px-2 py-1.5 disabled:bg-canvas disabled:text-ink-muted"
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {invoicableLines.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-sm text-ink-muted">
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
                className={BUTTON_SECONDARY_CLASS}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleCreateInvoice}
                disabled={actionBusy}
                className={BUTTON_PRIMARY_CLASS}
              >
                {actionBusy ? "创建中…" : "创建发票"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmActionDialog
        open={confirmAction !== null}
        title={
          confirmAction === "ready"
            ? "交付单就绪"
            : confirmAction === "cancel"
              ? "取消交付单"
              : confirmAction === "unconfirm"
                ? "反签收送货单"
                : "删除送货单"
        }
        description={
          confirmAction === "ready"
            ? "就绪后交付行将彻底冻结（不再可编辑）；就绪是发运的前置步骤。确认就绪？"
            : confirmAction === "cancel"
              ? "取消该交付单？仅 DRAFT/READY 可取消（DISPATCHED 及以后禁止）。确认后不可恢复。"
              : confirmAction === "unconfirm"
                ? "反签收该送货单（DELIVERED → DISPATCHED）？将撤销确认收货、POD 回退 PENDING，并重算销售订单交付状态（订单可回未发货）。仅无已开票发票时可反签收。"
                : "删除该送货单？仅 CANCELLED 或反签收后（DISPATCHED）状态可删除；DISPATCHED 删除将自动冲销已出库库存（REVERSAL 恢复），订单交付状态重算（回未发货）。确认后不可恢复。"
        }
        confirmLabel={
          confirmAction === "ready"
            ? "确认就绪"
            : confirmAction === "cancel"
              ? "确认取消"
              : confirmAction === "unconfirm"
                ? "确认反签收"
                : "确认删除"
        }
        tone={confirmAction === "ready" ? "primary" : "danger"}
        busy={actionBusy}
        onConfirm={() => {
          const a = confirmAction;
          setConfirmAction(null);
          if (a) void runAction(a);
        }}
        onCancel={() => setConfirmAction(null)}
      />

      {/* ── 发运对话框（可补充承运方/运单号） ── */}
      {dispatchOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
          onClick={() => setDispatchOpen(false)}
        >
          <div
            className="border-border bg-surface shadow-elevation-lg w-full max-w-md rounded-lg border p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-ink-primary text-base font-semibold">发运交付单</h2>
            <p className="text-ink-secondary mt-2 text-sm">
              发运将推进为 DISPATCHED 并<strong>扣减所选仓库库存</strong>（销售出库，不可逆——需删除送货单才恢复库存）。
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs text-ink-secondary">出库仓库（必填）</label>
                <select
                  value={dispatchWarehouseId}
                  onChange={(e) => setDispatchWarehouseId(e.target.value)}
                  className={"mt-1 " + INPUT_CLASS}
                >
                  <option value="">请选择出库仓库</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name ?? w.id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-ink-secondary">承运方（可选，≤100）</label>
                <input
                  value={dispatchCarrier}
                  onChange={(e) => setDispatchCarrier(e.target.value)}
                  maxLength={100}
                  className={"mt-1 " + INPUT_CLASS}
                />
              </div>
              <div>
                <label className="block text-xs text-ink-secondary">运单号（可选，≤100）</label>
                <input
                  value={dispatchTrackingNo}
                  onChange={(e) => setDispatchTrackingNo(e.target.value)}
                  maxLength={100}
                  className={"mt-1 " + INPUT_CLASS}
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDispatchOpen(false)}
                disabled={actionBusy}
                className="border-border text-ink-secondary rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!dispatchWarehouseId) {
                    setActionError(new ApiClientError(400, "请先选择出库仓库", "VALIDATION_ERROR"));
                    return;
                  }
                  void handleDispatch();
                }}
                disabled={actionBusy}
                className={BUTTON_PRIMARY_CLASS}
              >
                {actionBusy ? "发运中…" : "确认发运"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 确认收货对话框（POD 门禁） ── */}
      {confirmDeliverOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
          onClick={() => setConfirmDeliverOpen(false)}
        >
          <div
            className="border-border bg-surface shadow-elevation-lg w-full max-w-md rounded-lg border p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-ink-primary text-base font-semibold">确认收货</h2>
            <p className="text-ink-secondary mt-2 text-sm">
              确认后将状态推进为 DELIVERED，并回写销售订单交付投影（不可逆）。
            </p>
            <div className="mt-4">
              <label className="block text-xs text-ink-secondary">签收状态（POD）</label>
              <select
                value={podStatus}
                onChange={(e) => setPodStatus(e.target.value as "RECEIVED" | "WAIVED")}
                className={"mt-1 " + INPUT_CLASS}
              >
                <option value="RECEIVED">已签收（RECEIVED）</option>
                <option value="WAIVED">豁免签收（WAIVED）</option>
              </select>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeliverOpen(false)}
                disabled={actionBusy}
                className="border-border text-ink-secondary rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmDelivery}
                disabled={actionBusy}
                className={BUTTON_PRIMARY_CLASS}
              >
                {actionBusy ? "确认中…" : "确认收货"}
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