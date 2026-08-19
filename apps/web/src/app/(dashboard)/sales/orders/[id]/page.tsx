"use client";

/**
 * Sales Order Detail — 销售订单详情页（F2-6A Sales Read Foundation + F2-6B 批 1 动作）
 *
 * 只读 Detail：AppPage → EntityDetailWorkspace（Header → Summary → Lines）。
 * F2-6B 批 1：状态 Gate + 权限 Gate 后提供 Create Delivery（delivery:create）动作。
 * 按 CTO REQUEST CHANGES（93/100 Blocking ①）修复：
 * 不再“一键全量”POST——点击按钮打开 source-selection dialog：
 * 仅列出 remainingQty > 0 的行；每行 checkbox + quantity（默认剩余量，可改小）；
 * 至少选择一行；submit 后才 POST（后端逐行锁内校验 quantity <= availableQty）。
 * 正确暴露 backend 的 partial delivery contract。
 * confirm/cancel 等其它 factActions 仍不开放；不提供 Edit 入口。
 * PermissionGuard 对齐 API requirePermission("sales-order:view")。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import type { StatusTone } from "@/components/design-system";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, ConfirmActionDialog, EntityDetailWorkspace, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { useSession } from "@/lib/session-context";
import { formatDate, formatMoney } from "@/lib/format";

const TONE_MAP: Record<string, StatusTone> = {
  DRAFT: "neutral",
  CONFIRMED: "success",
  PARTIALLY_DELIVERED: "warning",
  DELIVERED: "success",
  COMPLETED: "success",
  CANCELLED: "danger",
};

interface SalesOrderLine {
  id: string;
  lineNo: number;
  description?: string | null;
  quantity: string;
  remainingQty?: string;
  unitPrice: string;
  item?: { id: string; code: string | null; name: string | null; model?: string | null } | null;
}

interface DeliveryCreatedResponse {
  id: string;
  code: string;
  status: string;
}

interface SalesOrderDetail {
  id: string;
  code: string;
  status: string;
  orderDate: string;
  currency: string;
  totalAmount: string;
  remark?: string | null;
  customer?: { id: string; code: string | null; name: string | null } | null;
  quotation?: { id: string; code: string | null; status: string | null } | null;
  lines?: SalesOrderLine[];
  createdAt: string;
}

/** dialog 选择状态：行 id → 是否勾选 + 交付数量 */
interface DeliverySelection {
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

function SalesOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { state } = useSession();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<SalesOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiClientError | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selections, setSelections] = useState<Record<string, DeliverySelection>>({});
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"confirm" | "cancel" | null>(null);

  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canCreateDelivery = hasPermission(roles, actionPermission("delivery", "create"));
  const canEdit = hasPermission(roles, actionPermission("sales-order", "edit"));
  const canApprove = hasPermission(roles, actionPermission("sales-order", "approve"));
  const canClose = hasPermission(roles, actionPermission("sales-order", "close"));
  const canDeliver =
    detail !== null &&
    (detail.status === "CONFIRMED" || detail.status === "PARTIALLY_DELIVERED");
  const remainingLines = (detail?.lines ?? []).filter(
    (l) => Number(l.remainingQty ?? l.quantity) > 0,
  );

  // ── 打开 dialog：默认全部剩余行勾选、数量 = remainingQty（用户可改小） ──
  const openDeliveryDialog = () => {
    if (remainingLines.length === 0) return;
    const next: Record<string, DeliverySelection> = {};
    for (const l of remainingLines) {
      next[l.id] = { checked: true, quantity: String(l.remainingQty ?? l.quantity) };
    }
    setSelections(next);
    setDialogError(null);
    setDialogOpen(true);
  };

  const closeDeliveryDialog = () => {
    setDialogOpen(false);
    setDialogError(null);
  };

  const updateSelection = (lineId: string, patch: Partial<DeliverySelection>) => {
    setSelections((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));
  };

  // ── submit：校验（至少一行；每行 quantity > 0 且 <= 剩余量）后才 POST ──
  const handleCreateDelivery = async () => {
    if (!detail || actionBusy) return;
    const selected = remainingLines.filter((l) => selections[l.id]?.checked);
    if (selected.length === 0) {
      setDialogError("请至少选择一行");
      return;
    }
    for (const l of selected) {
      const qty = Number(selections[l.id].quantity);
      const max = Number(l.remainingQty ?? l.quantity);
      if (!selections[l.id].quantity || !(qty > 0)) {
        setDialogError(`第 ${l.lineNo} 行：数量必须大于 0`);
        return;
      }
      if (qty > max) {
        setDialogError(`第 ${l.lineNo} 行：数量不能超过剩余可交付量 ${max}`);
        return;
      }
    }
    setActionBusy(true);
    setActionError(null);
    setDialogError(null);
    try {
      const body = await apiFetch<DeliveryCreatedResponse>(`/api/sales-orders/${id}/deliveries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: selected.map((l) => ({
            sourceSalesOrderLineId: l.id,
            quantity: Number(selections[l.id].quantity),
          })),
          changeReason: "从销售订单创建送货单",
        }),
      });
      closeDeliveryDialog();
      router.push(`/sales/deliveries/${body.data.id}`);
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "创建送货单失败", "NETWORK_ERROR"),
      );
      setActionBusy(false);
    }
  };

  const refreshDetail = async () => {
    try {
      const body = await apiFetch<SalesOrderDetail>(`/api/sales-orders/${id}`);
      setDetail(body.data);
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "刷新失败", "NETWORK_ERROR"),
      );
    }
  };

  // ── 确认订单 / 取消订单（无 body；后端状态机 + 审批门禁兜底） ──
  const runAction = async (action: "confirm" | "cancel") => {
    if (!detail || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await apiFetch(`/api/sales-orders/${id}/${action}`, { method: "POST" });
      await refreshDetail();
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "操作失败", "NETWORK_ERROR"),
      );
    } finally {
      setActionBusy(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<SalesOrderDetail>(`/api/sales-orders/${id}`, { signal: controller.signal })
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
        <Link href="/sales/orders" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
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
        title={`销售订单详情 — ${detail.code}`}
        backHref="/sales/orders"
        status={detail.status}
        statusLabel={detail.status}
        statusTone={TONE_MAP[detail.status] ?? "neutral"}
        actions={
          <>
            {detail.status === "DRAFT" && canEdit && (
              <Link
                href={`/sales/orders/${id}/edit`}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-primary hover:bg-slate-50"
              >
                编辑
              </Link>
            )}
            {detail.status === "DRAFT" && canApprove && (
              <button
                type="button"
                onClick={() => setConfirmAction("confirm")}
                disabled={actionBusy}
                className={BUTTON_PRIMARY_CLASS}
              >
                {actionBusy ? "处理中…" : "确认订单"}
              </button>
            )}
            {(detail.status === "DRAFT" || detail.status === "CONFIRMED") && canClose && (
              <button
                type="button"
                onClick={() => setConfirmAction("cancel")}
                disabled={actionBusy}
                className="rounded-md border border-status-danger-border bg-surface px-3 py-1.5 text-sm font-medium text-status-danger-text hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消订单
              </button>
            )}
            {canDeliver && canCreateDelivery && (
              <button
                type="button"
                onClick={openDeliveryDialog}
                disabled={actionBusy || remainingLines.length === 0}
                title={remainingLines.length === 0 ? "无剩余可交付数量" : undefined}
                className={BUTTON_PRIMARY_CLASS}
              >
                {actionBusy ? "创建中…" : "创建送货单"}
              </button>
            )}
          </>
        }
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="单号" value={detail.code} />
            <InfoItem label="客户" value={detail.customer?.name} />
            <InfoItem
              label="来源报价单"
              value={
                detail.quotation ? (
                  <Link
                    href={`/sales/quotations/${detail.quotation.id}`}
                    className="text-brand-600 hover:underline"
                  >
                    {detail.quotation.code}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            <InfoItem label="下单日期" value={formatDate(detail.orderDate)} />
            <InfoItem label="币种" value={detail.currency} />
            <InfoItem label="含税合计" value={formatMoney(detail.totalAmount, detail.currency)} />
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
                  <th className="px-3 py-2 font-medium">描述</th>
                  <th className="px-3 py-2 font-medium">数量</th>
                  <th className="px-3 py-2 font-medium">剩余可交付</th>
                  <th className="px-3 py-2 font-medium">单价</th>
                  <th className="px-3 py-2 font-medium">金额</th>
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
                    <td className="px-3 py-2 text-ink-primary">{line.quantity}</td>
                    <td className="px-3 py-2 text-ink-primary">
                      {line.remainingQty ?? line.quantity}
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">
                      {formatMoney(line.unitPrice, detail.currency)}
                    </td>
                    <td className="px-3 py-2 text-ink-primary">
                      {formatMoney(
                        String(Number(line.quantity) * Number(line.unitPrice || 0)),
                        detail.currency,
                      )}
                    </td>
                  </tr>
                ))}
                {(detail.lines ?? []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-sm text-ink-muted">
                      暂无明细行
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </EntityDetailWorkspace>

      {/* ── 创建送货单：source-selection dialog（partial delivery） ── */}
      {dialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={closeDeliveryDialog}
        >
          <div
            className="border-border bg-surface shadow-elevation-lg flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-border flex items-center justify-between border-b px-5 py-3">
              <h2 className="text-ink-primary text-base font-semibold">创建送货单 — 选择交付行</h2>
              <span className="text-ink-muted text-xs">支持分批发货</span>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              <p className="text-ink-muted mb-3 text-xs">
                勾选要交付的行并填写数量（默认剩余可交付量，可改小）；至少选择一行。数量最终由后端锁内校验。
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
                    <th className="px-3 py-2">剩余可交付</th>
                    <th className="px-3 py-2">本次数量</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {remainingLines.map((line) => {
                    const sel = selections[line.id];
                    const max = Number(line.remainingQty ?? line.quantity);
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
                  {remainingLines.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-400">
                        无剩余可交付数量
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="border-border flex justify-end gap-2 border-t px-5 py-3">
              <button
                type="button"
                onClick={closeDeliveryDialog}
                disabled={actionBusy}
                className={BUTTON_SECONDARY_CLASS}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleCreateDelivery}
                disabled={actionBusy}
                className={BUTTON_PRIMARY_CLASS}
              >
                {actionBusy ? "创建中…" : "创建送货单"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmActionDialog
        open={confirmAction !== null}
        title={confirmAction === "confirm" ? "确认销售订单" : "取消销售订单"}
        description={
          confirmAction === "confirm"
            ? "确认后将形成对客户的正式销售承诺（CONFIRMED），之后才可创建送货单。确认？"
            : "取消该销售订单？已交付/已完成的订单禁止取消。确认后不可恢复。"
        }
        confirmLabel={confirmAction === "confirm" ? "确认订单" : "确认取消"}
        tone={confirmAction === "cancel" ? "danger" : "primary"}
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
    <PermissionGuard permission={actionPermission("sales-order", "view")}>
      <SalesOrderDetailPage />
    </PermissionGuard>
  );
}