"use client";

/**
 * Quotation Detail — 报价单详情页（F2-6A Sales Read Foundation + F2-6B 批 1 动作）
 *
 * 只读 Detail：AppPage → EntityDetailWorkspace（Header → Summary → Lines）。
 * F2-6B 批 1：状态 Gate + 权限 Gate 后提供 Edit 入口（DRAFT/REJECTED）与
 * Convert→SO（ACCEPTED + 未过期 + 未转换，quotation:approve）动作按钮。
 * 其余 factActions（submit/accept/cancel）仍不开放。
 * PermissionGuard 对齐 API requirePermission("quotation:view")。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import type { StatusTone } from "@/components/design-system";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityDetailWorkspace, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS } from "@/lib/ui-classes";
import { useSession } from "@/lib/session-context";
import { formatDate, formatMoney } from "@/lib/format";

const TONE_MAP: Record<string, StatusTone> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  APPROVED: "success",
  SENT: "info",
  ACCEPTED: "success",
  REJECTED: "danger",
  CANCELLED: "danger",
  CONVERTED: "info",
  EXPIRED: "warning",
};

/** 状态中文业务名（Business UX Rationalization：枚举展示中文，不展示数据库枚举值；key 保留真实 enum） */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "已提交",
  APPROVED: "已批准",
  SENT: "已发送",
  ACCEPTED: "客户已接受",
  REJECTED: "已拒绝",
  CANCELLED: "已取消",
  CONVERTED: "已转订单",
  EXPIRED: "已过期",
};

interface QuotationLine {
  id: string;
  lineNo: number;
  description: string;
  quantity: string;
  unitPrice: string;
  totalAmount?: string;
  item?: { id: string; code: string | null; name: string | null; model?: string | null } | null;
}

interface QuotationDetail {
  id: string;
  code: string;
  status: string;
  effectiveStatus?: string;
  quoteDate: string;
  validUntil?: string | null;
  currency: string;
  subtotal?: string;
  taxAmount?: string;
  totalAmount: string;
  remark?: string | null;
  customer?: { id: string; code: string | null; name: string | null } | null;
  lines?: QuotationLine[];
  convertedAt?: string | null;
  salesOrderId?: string | null;
  createdAt: string;
}

interface ConvertResponse {
  salesOrder: { id: string; code: string; status: string };
  converted: boolean;
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
}

function QuotationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { state } = useSession();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<QuotationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiClientError | null>(null);

  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canEdit = hasPermission(roles, actionPermission("quotation", "edit"));
  const canApprove = hasPermission(roles, actionPermission("quotation", "approve"));
  const canClose = hasPermission(roles, actionPermission("quotation", "close"));
  const canConvert =
    detail !== null &&
    detail.status === "ACCEPTED" &&
    detail.effectiveStatus !== "EXPIRED" &&
    !detail.convertedAt &&
    !detail.salesOrderId;
  // Phase 2 Batch 1：补全动作矩阵（API 允许但 UI 无入口 → 补齐；状态/权限与后端一致）
  const canSubmit =
    detail !== null &&
    detail.status === "DRAFT" &&
    detail.effectiveStatus !== "EXPIRED" &&
    canEdit;
  const canAccept =
    detail !== null &&
    (detail.status === "APPROVED" || detail.status === "SENT") &&
    detail.effectiveStatus !== "EXPIRED" &&
    canApprove;
  const canCancel =
    detail !== null &&
    (detail.status === "DRAFT" ||
      detail.status === "SUBMITTED" ||
      detail.status === "APPROVED" ||
      detail.status === "SENT") &&
    canClose;

  const handleConvert = async () => {
    if (!detail || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const body = await apiFetch<ConvertResponse>(`/api/quotations/${id}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changeReason: "报价单转为销售订单" }),
      });
      router.push(`/sales/orders/${body.data.salesOrder.id}`);
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "转换失败", "NETWORK_ERROR"),
      );
      setActionBusy(false);
    }
  };

  const reloadDetail = () => {
    setLoading(true);
    setError(null);
    apiFetch<QuotationDetail>(`/api/quotations/${id}`)
      .then((body) => setDetail(body.data))
      .catch((err: unknown) => {
        setError(
          err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"),
        );
      })
      .finally(() => setLoading(false));
  };

  const runAction = async (path: string) => {
    if (!detail || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await apiFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      reloadDetail();
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "操作失败", "NETWORK_ERROR"),
      );
      setActionBusy(false);
    }
  };

  const handleSubmit = () => runAction(`/api/quotations/${id}/submit`);
  const handleAccept = () => runAction(`/api/quotations/${id}/accept`);
  const handleCancel = async () => {
    if (!detail || actionBusy) return;
    if (!window.confirm("确定取消该报价单？取消后不可恢复。")) return;
    await runAction(`/api/quotations/${id}/cancel`);
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<QuotationDetail>(`/api/quotations/${id}`, { signal: controller.signal })
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
        <Link href="/sales/quotations" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
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
        title={`报价单详情 — ${detail.code}`}
        backHref="/sales/quotations"
        status={detail.effectiveStatus ?? detail.status}
        statusLabel={STATUS_LABELS[detail.effectiveStatus ?? detail.status] ?? detail.effectiveStatus ?? detail.status}
        statusTone={TONE_MAP[detail.effectiveStatus ?? detail.status] ?? "neutral"}
        actions={
          canEdit || canSubmit || canAccept || canCancel || (canConvert && canApprove) ? (
            <>
              {canEdit && (detail.status === "DRAFT" || detail.status === "REJECTED") && (
                <Link
                  href={`/sales/quotations/${id}/edit`}
                  className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-primary hover:bg-canvas"
                >
                  编辑
                </Link>
              )}
              {canSubmit && (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={actionBusy}
                  className={BUTTON_PRIMARY_CLASS}
                >
                  {actionBusy ? "提交中…" : "提交审批"}
                </button>
              )}
              {canAccept && (
                <button
                  type="button"
                  onClick={handleAccept}
                  disabled={actionBusy}
                  className={BUTTON_PRIMARY_CLASS}
                >
                  {actionBusy ? "处理中…" : "客户接受"}
                </button>
              )}
              {canCancel && (
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={actionBusy}
                  className="rounded-md border border-status-danger-border bg-surface px-3 py-1.5 text-sm font-medium text-status-danger-text hover:bg-status-danger-bg"
                >
                  {actionBusy ? "处理中…" : "取消报价"}
                </button>
              )}
              {canConvert && canApprove && (
                <button
                  type="button"
                  onClick={handleConvert}
                  disabled={actionBusy}
                  className={BUTTON_PRIMARY_CLASS}
                >
                  {actionBusy ? "转换中…" : "转为销售订单"}
                </button>
              )}
            </>
          ) : undefined
        }
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="单号" value={detail.code} />
            <InfoItem label="客户" value={detail.customer?.name} />
            <InfoItem label="报价日期" value={formatDate(detail.quoteDate)} />
            <InfoItem label="有效期至" value={formatDate(detail.validUntil)} />
            <InfoItem label="币种" value={detail.currency} />
            <InfoItem label="未税合计" value={formatMoney(detail.subtotal ?? "0", detail.currency)} />
            <InfoItem label="税额" value={formatMoney(detail.taxAmount ?? "0", detail.currency)} />
            <InfoItem label="含税合计" value={formatMoney(detail.totalAmount, detail.currency)} />
            <InfoItem label="备注" value={detail.remark} />
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
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">审计信息</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
            <InfoItem label="转换时间" value={formatDate(detail.convertedAt)} />
          </div>
        </section>
      </EntityDetailWorkspace>
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("quotation", "view")}>
      <QuotationDetailPage />
    </PermissionGuard>
  );
}