"use client";

/**
 * Purchase Orders — 采购订单详情页（F2-3 Batch C1 Consolidation，CTO #11888）
 *
 * 由旧式布局迁移至统一 Workspace：
 * AppPage → EntityDetailWorkspace（Header Summary → Status → Actions → Sections → Audit）。
 * 保留 Batch A 的 DRAFT 编辑入口；不改 backend / 状态机 / action。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, ConfirmActionDialog, EntityDetailWorkspace, ErrorPanel } from "@/components/workspace";
import { CopyButton } from "@/components/ui/copy-button";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS } from "@/lib/ui-classes";
import { formatDate, formatMoney } from "@/lib/format";

/** 状态中文业务名（Business UX Rationalization：枚举展示中文，不展示数据库枚举值；key 保留真实 enum） */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "已提交",
  APPROVED: "已批准",
  CONFIRMED: "已确认",
  PARTIALLY_RECEIVED: "部分收货",
  RECEIVED: "已收货",
  CANCELLED: "已取消",
};

/** 来源类型中文（Phase 2：枚举展示中文，不展示数据库枚举值） */
const SOURCE_TYPE_LABELS: Record<string, string> = {
  REQUISITION: "来自采购申请",
  DIRECT: "直接采购",
};

interface OrderDetail {
  id: string;
  code: string;
  sourceType?: string | null;
  status: string;
  currency?: string | null;
  paymentTerm?: string | null;
  orderDate?: string | null;
  expectedDeliveryDate?: string | null;
  subtotal?: string | null;
  taxAmount?: string | null;
  totalAmount?: string | null;
  remark?: string | null;
  confirmedAt?: string | null;
  supplier?: { name: string | null } | null;
  requisition?: { id: string; code: string | null } | null;
  lines?: Array<{
    id: string;
    lineNo: number;
    description: string;
    quantity: string;
    unitPrice?: string | null;
    totalAmount?: string | null;
    priceSource?: string | null;
    // 核销闭环（用户指令 2026-08-21）：行级下游聚合——已收(accepted)/已入库/已退
    receivedAcceptedQty?: string | null;
    stockInQty?: string | null;
    returnedQty?: string | null;
    item?: { code: string | null; name: string | null } | null;
    uom?: { symbol: string | null } | null;
  }>;
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
}

function OrderDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const { state } = useSession();
  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canEdit = hasPermission(roles, actionPermission("purchase-order", "edit"));
  const canApprove = hasPermission(roles, actionPermission("purchase-order", "approve"));
  const canClose = hasPermission(roles, actionPermission("purchase-order", "close"));
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiClientError | null>(null);
  const [confirmAction, setConfirmAction] = useState<"submit" | "confirm" | "cancel" | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<OrderDetail>(`/api/purchase-orders/${id}`, { signal: controller.signal })
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
      const body = await apiFetch<OrderDetail>(`/api/purchase-orders/${id}`);
      setDetail(body.data);
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "刷新失败", "NETWORK_ERROR"),
      );
    }
  };

  const runAction = async (action: "submit" | "confirm" | "cancel") => {
    if (!detail || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await apiFetch(`/api/purchase-orders/${id}/${action}`, { method: "POST" });
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
        <Link href="/purchasing/orders" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
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
        title={`采购订单详情 — ${detail.code}`}
        backHref="/purchasing/orders"
        status={detail.status}
        statusLabel={STATUS_LABELS[detail.status] ?? detail.status}
        actions={
          <>
            {detail.status === "DRAFT" && canEdit && (
              <Link
                href={`/purchasing/orders/${id}/edit`}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-primary hover:bg-canvas"
              >
                编辑
              </Link>
            )}
            {detail.status === "DRAFT" && canEdit && (
              <button
                type="button"
                onClick={() => setConfirmAction("submit")}
                disabled={actionBusy}
                className={BUTTON_PRIMARY_CLASS}
              >
                {actionBusy ? "处理中…" : "提交生效"}
              </button>
            )}
            {detail.status === "APPROVED" && canApprove && (
              <button
                type="button"
                onClick={() => setConfirmAction("confirm")}
                disabled={actionBusy}
                className={BUTTON_PRIMARY_CLASS}
              >
                {actionBusy ? "处理中…" : "确认订单"}
              </button>
            )}
            {(detail.status === "DRAFT" || detail.status === "APPROVED") && canClose && (
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
        }
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem
              label="单号"
              value={
                <span className="inline-flex items-center gap-2">
                  {detail.code}
                  <CopyButton text={detail.code} size="sm" />
                </span>
              }
            />
            <InfoItem label="来源类型" value={SOURCE_TYPE_LABELS[detail.sourceType ?? ""] ?? detail.sourceType} />
            <InfoItem label="供应商" value={detail.supplier?.name} />
            <InfoItem
              label="来源申请"
              value={
                detail.requisition?.code ? (
                  <Link
                    href={`/purchasing/requisitions/${detail.requisition.id}`}
                    className="font-medium text-brand-600 hover:underline"
                  >
                    {detail.requisition.code}
                  </Link>
                ) : (
                  null
                )
              }
            />
            <InfoItem label="币种" value={detail.currency} />
            <InfoItem label="付款条款" value={detail.paymentTerm} />
            <InfoItem label="下单日期" value={formatDate(detail.orderDate)} />
            <InfoItem label="期望交期" value={formatDate(detail.expectedDeliveryDate)} />
            <InfoItem label="未税合计" value={formatMoney(detail.subtotal ?? "0", detail.currency ?? "CNY")} />
            <InfoItem label="税额" value={formatMoney(detail.taxAmount ?? "0", detail.currency ?? "CNY")} />
            <InfoItem label="含税合计" value={formatMoney(detail.totalAmount ?? "0", detail.currency ?? "CNY")} />
            <InfoItem label="确认时间" value={formatDate(detail.confirmedAt)} />
            <InfoItem label="备注" value={detail.remark} />
          </div>
        }
      >
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">
            订单行（{detail.lines?.length ?? 0}）
          </h2>
          <div className="overflow-x-auto">
            <table className="divide-border min-w-full divide-y text-sm">
              <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">行号</th>
                  <th className="px-3 py-2 font-medium">物料</th>
                  <th className="px-3 py-2 font-medium">描述</th>
                  <th className="px-3 py-2 font-medium">数量</th>
                  <th className="px-3 py-2 font-medium">单位</th>
                  <th className="px-3 py-2 font-medium">单价</th>
                  <th className="px-3 py-2 font-medium">价格来源</th>
                  <th className="px-3 py-2 font-medium">已收</th>
                  <th className="px-3 py-2 font-medium">已入</th>
                  <th className="px-3 py-2 font-medium">已退</th>
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
                    <td className="px-3 py-2 text-ink-secondary">{line.uom?.symbol ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-primary">{line.unitPrice ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{line.priceSource ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-primary">{line.receivedAcceptedQty ?? "0"}</td>
                    <td className="px-3 py-2 text-ink-primary">{line.stockInQty ?? "0"}</td>
                    <td className="px-3 py-2 text-ink-primary">{line.returnedQty ?? "0"}</td>
                  </tr>
                ))}
                {(detail.lines ?? []).length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center text-sm text-ink-muted">
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
        title={
          confirmAction === "submit"
            ? "提交采购订单审批"
            : confirmAction === "confirm"
              ? "确认采购订单"
              : "取消采购订单"
        }
        description={
          confirmAction === "submit"
            ? "提交即生效（已自动批准），可继续确认/收货。确认提交？"
            : confirmAction === "confirm"
              ? "确认后形成对供应商的正式采购承诺（CONFIRMED），之后才可收货。确认？"
              : "取消该采购订单？仅 DRAFT/APPROVED 可取消（已确认订单禁止取消）。"
        }
        confirmLabel={confirmAction === "confirm" ? "确认订单" : confirmAction === "cancel" ? "确认取消" : "确认提交"}
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
    <PermissionGuard permission={PERMISSIONS.PURCHASE_ORDER_READ}>
      <OrderDetailPage />
    </PermissionGuard>
  );
}