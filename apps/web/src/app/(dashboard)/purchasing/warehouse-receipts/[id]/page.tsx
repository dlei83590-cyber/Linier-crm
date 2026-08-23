"use client";

/**
 * Warehouse Receipts — 仓库收货详情页（F2-3 Batch C1 Consolidation，CTO #11888）
 *
 * 由旧式布局迁移至统一 Workspace：
 * AppPage → EntityDetailWorkspace（Header Summary → Status → Actions → Sections）。
 * 保留 Batch B2 的 DRAFT 编辑入口；不改 backend / 状态机 / action。
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
  POSTED: "已过账",
  CANCELLED: "已取消",
};

interface WarehouseReceiptDetail {
  id: string;
  version: number;
  code: string;
  status: string;
  postedAt?: string | null;
  remark?: string | null;
  createdAt: string;
  purchaseReceipt?: {
    id?: string | null;
    code: string | null;
    status: string | null;
    receivedAt?: string | null;
    purchaseOrder?: { id?: string | null; code?: string | null } | null;
  } | null;
  warehouse?: { name: string | null } | null;
  location?: { name: string | null } | null;
  postedBy?: { name: string | null } | null;
  lines?: Array<{
    id: string;
    quantity: string;
    // 核销闭环：可退余额 = quantity - 已退（一键退货使用）
    returnableQty?: string;
    batchNo?: string | null;
    serialNos?: string[];
    mfgDate?: string | null;
    expDate?: string | null;
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

function WarehouseReceiptDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const { state } = useSession();
  const canEdit =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("warehouse-receipt", "edit"));
  const [detail, setDetail] = useState<WarehouseReceiptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiClientError | null>(null);
  const [confirmPost, setConfirmPost] = useState(false);
  // 一键退货（集成在仓库收货中退货，用户指令 2026-08-21）：退货 + 反收货
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnDisposition, setReturnDisposition] = useState("REPLACE_REQUIRED");
  const [returnBusy, setReturnBusy] = useState(false);
  // 一键回退整链（退货成功后，用户指令 2026-08-21）
  const [confirmUnwind, setConfirmUnwind] = useState(false);
  const [unwindBusy, setUnwindBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<WarehouseReceiptDetail>(`/api/warehouse-receipts/${id}`, { signal: controller.signal })
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
      const body = await apiFetch<WarehouseReceiptDetail>(`/api/warehouse-receipts/${id}`);
      setDetail(body.data);
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "刷新失败", "NETWORK_ERROR"),
      );
    }
  };

  const handlePost = async () => {
    if (!detail || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await apiFetch(`/api/warehouse-receipts/${id}/post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: detail.version }),
      });
      await refreshDetail();
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "过账失败", "NETWORK_ERROR"),
      );
    } finally {
      setActionBusy(false);
    }
  };

  /** 一键退货（集成在仓库收货中）：创建退货（全部可退行）→ 完成退货（GRIR REVERSAL + PO reopen）→ 反收货（回滚收货投影） */
  const handleReturn = async () => {
    if (!detail || returnBusy || actionBusy) return;
    const poId = detail.purchaseReceipt?.purchaseOrder?.id;
    const rcId = detail.purchaseReceipt?.id;
    if (!poId || !rcId) {
      setActionError(new ApiClientError(0, "缺少来源采购订单/收货单信息", "INVALID"));
      return;
    }
    const rows = (detail.lines ?? []).filter((l) => Number(l.returnableQty ?? l.quantity ?? 0) > 0);
    if (rows.length === 0) {
      setActionError(new ApiClientError(0, "该入库单无可退行（已全部退货）", "INVALID"));
      return;
    }
    setReturnBusy(true);
    setActionError(null);
    try {
      // ① 创建退货单（DRAFT；全部可退行，数量=可退余额）
      const created = await apiFetch<{ id: string }>("/api/purchase-returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchaseOrderId: poId,
          returnType: "RETURN_AFTER_STOCK_IN",
          remark: `仓库收货一键退货（入库单 ${detail.code}）`,
          lines: rows.map((l) => ({
            sourceRefType: "WAREHOUSE_RECEIPT_LINE",
            sourceWarehouseReceiptLineId: l.id,
            quantity: Number(l.returnableQty ?? l.quantity),
            disposition: returnDisposition,
            returnReason: "仓库收货一键退货",
          })),
        }),
      });
      // ② 完成退货（RETURNED：GRIR REVERSAL + PO 履约 reopen）
      await apiFetch(`/api/purchase-returns/${created.data.id}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1 }),
      });
      // ③ 反收货（收货单全部入库行已退货 → 回滚履约投影）
      await apiFetch(`/api/purchase-receipts/${rcId}/unreceive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changeReason: "仓库收货一键退货（含反收货）" }),
      });
      setReturnOpen(false);
      await refreshDetail();
      setActionError(null);
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "退货失败", "NETWORK_ERROR"),
      );
    } finally {
      setReturnBusy(false);
    }
  };

  /** 一键回退整链（删退货→反质检→反收货→删收货→删PO→回退并删PR；全程回收单号） */
  const handleUnwind = async () => {
    if (!detail || unwindBusy) return;
    setUnwindBusy(true);
    setActionError(null);
    try {
      await apiFetch(`/api/warehouse-receipts/${id}/unwind`, { method: "POST" });
      setConfirmUnwind(false);
      await refreshDetail();
    } catch (err: unknown) {
      setActionError(err instanceof ApiClientError ? err : new ApiClientError(0, "回退失败", "NETWORK_ERROR"));
    } finally {
      setUnwindBusy(false);
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
        <Link href="/purchasing/warehouse-receipts" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
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
        title={`仓库收货详情 — ${detail.code}`}
        backHref="/purchasing/warehouse-receipts"
        status={detail.status}
        statusLabel={STATUS_LABELS[detail.status] ?? detail.status}
        actions={
          detail.status === "DRAFT" && canEdit ? (
            <>
              <Link
                href={`/purchasing/warehouse-receipts/${id}/edit`}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-primary hover:bg-canvas"
              >
                编辑
              </Link>
              <button
                type="button"
                onClick={() => setConfirmPost(true)}
                disabled={actionBusy}
                className={BUTTON_PRIMARY_CLASS}
              >
                {actionBusy ? "处理中…" : "过账"}
              </button>
            </>
          ) : detail.status === "POSTED" && canEdit ? (
            (detail.lines ?? []).some((l) => Number(l.returnableQty ?? l.quantity ?? 0) > 0) ? (
              <button
                type="button"
                onClick={() => setReturnOpen(true)}
                disabled={actionBusy || returnBusy || unwindBusy}
                className="rounded-md border border-status-danger-border bg-status-danger-bg/10 px-3 py-1.5 text-sm font-medium text-status-danger-text hover:bg-status-danger-bg/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {returnBusy ? "退货中…" : "退货（一键）"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmUnwind(true)}
                disabled={actionBusy || unwindBusy}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-primary hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
              >
                {unwindBusy ? "回退中…" : "回退整链"}
              </button>
            )
          ) : undefined
        }
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="入库单号" value={detail.code} />
            <InfoItem
              label="来源收货单"
              value={
                detail.purchaseReceipt?.code
                  ? `${detail.purchaseReceipt.code}${detail.purchaseReceipt.status ? `（${detail.purchaseReceipt.status}）` : ""}`
                  : null
              }
            />
            <InfoItem label="仓库" value={detail.warehouse?.name} />
            <InfoItem label="库位" value={detail.location?.name} />
            <InfoItem label="过账人" value={detail.postedBy?.name} />
            <InfoItem label="过账时间" value={formatDate(detail.postedAt)} />
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
            <InfoItem label="备注" value={detail.remark} />
          </div>
        }
      >
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">
            入库行（{detail.lines?.length ?? 0}）
          </h2>
          <div className="overflow-x-auto">
            <table className="divide-border min-w-full divide-y text-sm">
              <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">物料</th>
                  <th className="px-3 py-2 font-medium">数量</th>
                  <th className="px-3 py-2 font-medium">单位</th>
                  <th className="px-3 py-2 font-medium">批次</th>
                  <th className="px-3 py-2 font-medium">序列号数</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {(detail.lines ?? []).map((line) => (
                  <tr key={line.id}>
                    <td className="px-3 py-2 text-ink-primary">
                      {line.item ? `${line.item.code ?? ""} ${line.item.name ?? ""}`.trim() : "—"}
                    </td>
                    <td className="px-3 py-2 text-ink-primary">{line.quantity}</td>
                    <td className="px-3 py-2 text-ink-secondary">{line.uom?.symbol ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{line.batchNo ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{line.serialNos?.length ?? 0}</td>
                  </tr>
                ))}
                {(detail.lines ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-sm text-ink-muted">
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
        open={confirmUnwind}
        title="回退整链"
        description="一键全链条回退：删除退货单 → 反质检 → 反收货（回滚履约）→ 删除收货单 → 删除采购订单 → 回退并删除采购申请；全程回收单号（GRIR/库存/财务历史保留）。"
        confirmLabel="确认回退整链"
        tone="danger"
        busy={unwindBusy}
        onConfirm={handleUnwind}
        onCancel={() => setConfirmUnwind(false)}
      />

      <ConfirmActionDialog
        open={confirmPost}
        title="过账入库"
        description="过账将触发库存流水（InventoryMovement IN，同事务落账），不可逆。确认过账？"
        confirmLabel="确认过账"
        tone="danger"
        busy={actionBusy}
        onConfirm={() => {
          setConfirmPost(false);
          void handlePost();
        }}
        onCancel={() => setConfirmPost(false)}
      />

      {/* ── 一键退货对话框（集成在仓库收货中退货 + 反收货；用户指令 2026-08-21） ── */}
      {returnOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setReturnOpen(false)}
        >
          <div
            className="border-border bg-surface shadow-elevation-lg w-full max-w-md rounded-lg border p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-ink-primary text-base font-semibold">退货并反收货（一键）</h2>
            <p className="text-ink-secondary mt-2 text-xs">
              对全部可退入库行创建退货并完成（GRIR 冲销 + PO 履约 reopen），同时反收货回滚收货投影（收货单回草稿、入库单可删）。
            </p>
            <div className="mt-4 text-sm">
              <label className="block text-xs text-ink-secondary">处置方式（必填）</label>
              <select
                value={returnDisposition}
                onChange={(e) => setReturnDisposition(e.target.value)}
                className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
              >
                <option value="REPLACE_REQUIRED">补货（供应商仍欠货，重开 PO 待交）</option>
                <option value="CREDIT_ONLY">仅退款（不重开待交）</option>
              </select>
              <p className="text-ink-muted mt-2 text-xs">
                将退货 {detail.lines?.length ?? 0} 行、数量按各可退余额自动带出。
              </p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReturnOpen(false)}
                disabled={returnBusy}
                className="border-border text-ink-secondary rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleReturn}
                disabled={returnBusy}
                className="rounded-md bg-status-danger-bg/10 border border-status-danger-border px-3 py-1.5 text-sm font-medium text-status-danger-text hover:bg-status-danger-bg/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {returnBusy ? "退货中…" : "确认退货并反收货"}
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
    <PermissionGuard permission={PERMISSIONS.WAREHOUSE_RECEIPT_READ}>
      <WarehouseReceiptDetailPage />
    </PermissionGuard>
  );
}