"use client";

/**
 * Purchase Receipts — 到货收货详情页（F2-3 Batch C1 Consolidation，CTO #11888）
 *
 * 由旧式布局迁移至统一 Workspace：
 * AppPage → EntityDetailWorkspace（Header Summary → Status → Actions → Sections）。
 * 保留 Batch B1 的 DRAFT 编辑入口；不改 backend / 状态机 / action。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, ConfirmActionDialog, EntityDetailWorkspace, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS } from "@/lib/ui-classes";
import { formatDate } from "@/lib/format";

/** 状态中文业务名（Business UX Rationalization：枚举展示中文，不展示数据库枚举值；key 保留真实 enum） */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  RECEIVED: "已收货",
  CANCELLED: "已取消",
};

interface ReceiptDetail {
  id: string;
  code: string;
  status: string;
  receivedAt?: string | null;
  remark?: string | null;
  purchaseOrder?: { code: string | null; status: string | null } | null;
  supplier?: { name: string | null } | null;
  warehouse?: { name: string | null } | null;
  receivedBy?: { name: string | null } | null;
  lines?: Array<{
    id: string;
    lineNo: number;
    quantity: string;
    visibleDamageQty?: string | null;
    rejectedOnReceiptQty?: string | null;
    remark?: string | null;
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

function ReceiptDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const { state } = useSession();
  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canEdit = hasPermission(roles, actionPermission("purchase-receipt", "edit"));
  const canClose = hasPermission(roles, actionPermission("purchase-receipt", "close"));
  const [detail, setDetail] = useState<ReceiptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiClientError | null>(null);
  const [confirmAction, setConfirmAction] = useState<"receive" | "cancel" | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<ReceiptDetail>(`/api/purchase-receipts/${id}`, { signal: controller.signal })
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
      const body = await apiFetch<ReceiptDetail>(`/api/purchase-receipts/${id}`);
      setDetail(body.data);
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "刷新失败", "NETWORK_ERROR"),
      );
    }
  };

  const runAction = async (action: "receive" | "cancel") => {
    if (!detail || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await apiFetch(`/api/purchase-receipts/${id}/${action}`, { method: "POST" });
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
        <Link href="/purchasing/receipts" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
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
        title={`到货收货详情 — ${detail.code}`}
        backHref="/purchasing/receipts"
        status={detail.status}
        statusLabel={STATUS_LABELS[detail.status] ?? detail.status}
        actions={
          detail.status === "DRAFT" && (canEdit || canClose) ? (
            <>
              {canEdit && (
                <>
                  <Link
                    href={`/purchasing/receipts/${id}/edit`}
                    className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-primary hover:bg-canvas"
                  >
                    编辑
                  </Link>
                  <button
                    type="button"
                    onClick={() => setConfirmAction("receive")}
                    disabled={actionBusy}
                    className={BUTTON_PRIMARY_CLASS}
                  >
                    {actionBusy ? "处理中…" : "确认收货"}
                  </button>
                </>
              )}
              {canClose && (
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
            <InfoItem label="收货单号" value={detail.code} />
            <InfoItem
              label="采购订单"
              value={
                detail.purchaseOrder?.code
                  ? `${detail.purchaseOrder.code}${detail.purchaseOrder.status ? `（${detail.purchaseOrder.status}）` : ""}`
                  : null
              }
            />
            <InfoItem label="供应商" value={detail.supplier?.name} />
            <InfoItem label="仓库" value={detail.warehouse?.name} />
            <InfoItem label="收货人" value={detail.receivedBy?.name} />
            <InfoItem label="收货时间" value={formatDate(detail.receivedAt)} />
            <InfoItem label="备注" value={detail.remark} />
          </div>
        }
      >
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">
            收货行（{detail.lines?.length ?? 0}）
          </h2>
          <div className="overflow-x-auto">
            <table className="divide-border min-w-full divide-y text-sm">
              <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">行号</th>
                  <th className="px-3 py-2 font-medium">物料</th>
                  <th className="px-3 py-2 font-medium">数量</th>
                  <th className="px-3 py-2 font-medium">单位</th>
                  <th className="px-3 py-2 font-medium">可见损坏</th>
                  <th className="px-3 py-2 font-medium">现场拒收</th>
                  <th className="px-3 py-2 font-medium">备注</th>
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
                    <td className="px-3 py-2 text-ink-secondary">{line.uom?.symbol ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{line.visibleDamageQty ?? "0"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{line.rejectedOnReceiptQty ?? "0"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{line.remark ?? "—"}</td>
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

      <ConfirmActionDialog
        open={confirmAction !== null}
        title={confirmAction === "receive" ? "确认收货" : "取消到货单"}
        description={
          confirmAction === "receive"
            ? "确认收货将回写采购订单行收货投影（RECEIVED），之后可创建质检/入库。确认？"
            : "取消该到货单？仅 DRAFT 可取消。确认后不可恢复。"
        }
        confirmLabel={confirmAction === "receive" ? "确认收货" : "确认取消"}
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
    <PermissionGuard permission={PERMISSIONS.PURCHASE_RECEIPT_READ}>
      <ReceiptDetailPage />
    </PermissionGuard>
  );
}