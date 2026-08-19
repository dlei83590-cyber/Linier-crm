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
import { BUTTON_PRIMARY_CLASS } from "@/lib/ui-classes";
import { useSession } from "@/lib/session-context";
import { formatDate, formatMoney } from "@/lib/format";

const TONE_MAP: Record<string, StatusTone> = {
  DRAFT: "neutral",
  ISSUED: "info",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  CANCELLED: "danger",
};

interface InvoiceLine {
  id: string;
  lineNo: number;
  description?: string | null;
  quantity: string;
  unitPrice: string;
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

type ConfirmAction = "issue" | "cancel";

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

  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canApprove = hasPermission(roles, actionPermission("invoice", "approve"));
  const canClose = hasPermission(roles, actionPermission("invoice", "close"));
  const isDraft = detail !== null && detail.status === "DRAFT";

  const loadDetail = async () => {
    try {
      const body = await apiFetch<InvoiceDetail>(`/api/invoices/${id}`);
      setDetail(body.data);
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
        await apiFetch(`/api/invoices/${id}/issue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ changeReason: "对外开票" }),
        });
      } else {
        await apiFetch(`/api/invoices/${id}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ changeReason: "取消草稿发票" }),
        });
      }
      await loadDetail();
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
        statusLabel={detail.status}
        statusTone={TONE_MAP[detail.status] ?? "neutral"}
        actions={
          (isDraft && canApprove) || (isDraft && canClose) ? (
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
                  <th className="px-3 py-2 font-medium">数量</th>
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

      <ConfirmActionDialog
        open={confirmAction !== null}
        title={confirmAction === "issue" ? "开具发票" : "取消发票"}
        description={
          confirmAction === "issue"
            ? "开具后将生成正式发票编号（ISSUED），不可撤销；发票审批未通过时后端会拒绝。确认开具？"
            : "取消该草稿发票？取消后释放送货单已占用的开票数量（ISSUED 后禁止直接取消，需走贷项通知单）。"
        }
        confirmLabel={confirmAction === "issue" ? "确认开具" : "确认取消"}
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
    <PermissionGuard permission={actionPermission("invoice", "view")}>
      <InvoiceDetailPage />
    </PermissionGuard>
  );
}