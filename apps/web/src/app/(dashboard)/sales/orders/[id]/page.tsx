"use client";

/**
 * Sales Order Detail — 销售订单详情页（F2-6A Sales Read Foundation + F2-6B 批 1 动作）
 *
 * 只读 Detail：AppPage → EntityDetailWorkspace（Header → Summary → Lines）。
 * F2-6B 批 1：状态 Gate + 权限 Gate 后提供 Create Delivery（delivery:create）动作按钮，
 * 携带剩余可交付行（sourceSalesOrderLineId + remainingQty）创建 DRAFT 送货单。
 * confirm/cancel 等其它 factActions 仍不开放；不提供 Edit 入口。
 * PermissionGuard 对齐 API requirePermission("sales-order:view")。
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

  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canCreateDelivery = hasPermission(roles, actionPermission("delivery", "create"));
  const canDeliver =
    detail !== null &&
    (detail.status === "CONFIRMED" || detail.status === "PARTIALLY_DELIVERED");
  const remainingLines = (detail?.lines ?? []).filter(
    (l) => Number(l.remainingQty ?? l.quantity) > 0,
  );

  const handleCreateDelivery = async () => {
    if (!detail || actionBusy) return;
    if (remainingLines.length === 0) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const body = await apiFetch<DeliveryCreatedResponse>(`/api/sales-orders/${id}/deliveries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: remainingLines.map((l) => ({
            sourceSalesOrderLineId: l.id,
            quantity: Number(l.remainingQty ?? l.quantity),
          })),
          changeReason: "从销售订单创建送货单",
        }),
      });
      router.push(`/sales/deliveries/${body.data.id}`);
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "创建送货单失败", "NETWORK_ERROR"),
      );
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
          canDeliver && canCreateDelivery ? (
            <button
              type="button"
              onClick={handleCreateDelivery}
              disabled={actionBusy || remainingLines.length === 0}
              title={remainingLines.length === 0 ? "无剩余可交付数量" : undefined}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {actionBusy ? "创建中…" : "创建送货单"}
            </button>
          ) : undefined
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
