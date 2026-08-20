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
  purchaseReceipt?: { code: string | null; status: string | null; receivedAt?: string | null } | null;
  warehouse?: { name: string | null } | null;
  location?: { name: string | null } | null;
  postedBy?: { name: string | null } | null;
  lines?: Array<{
    id: string;
    quantity: string;
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