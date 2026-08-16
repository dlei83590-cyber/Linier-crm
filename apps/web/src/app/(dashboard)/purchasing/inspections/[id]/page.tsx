"use client";

/**
 * Inspections — 质检记录详情页（F2-3 Batch C1 Consolidation，CTO #11888）
 *
 * 由旧式布局迁移至统一 Workspace：
 * AppPage → EntityDetailWorkspace（Header Summary → Status → Actions → Sections）。
 * 不改 backend / 状态机 / action。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { AppPage, EntityDetailWorkspace, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { formatDate } from "@/lib/format";

interface InspectionDetail {
  id: string;
  version: number;
  inspectionMode: string;
  result: string;
  qualifiedQty: string;
  rejectedQty: string;
  inspectedAt?: string | null;
  remark?: string | null;
  createdAt: string;
  inspectedBy?: { name: string | null } | null;
  purchaseReceiptLine?: {
    lineNo: number;
    quantity: string;
    rejectedOnReceiptQty: string;
    visibleDamageQty: string;
    purchaseReceipt?: { code: string | null; status: string | null; receivedAt?: string | null } | null;
    purchaseOrderLine?: { lineNo: number | null; quantity: string | null; fulfillmentType: string | null } | null;
    item?: { code: string | null; name: string | null; model: string | null } | null;
    uom?: { code: string | null; symbol: string | null } | null;
  } | null;
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
}

function InspectionDetailPage() {
  const { state } = useSession();
  const canEdit =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("inspection", "edit"));
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<InspectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiClientError | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [qualifiedQty, setQualifiedQty] = useState("");
  const [rejectedQty, setRejectedQty] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<InspectionDetail>(`/api/inspections/${id}`, { signal: controller.signal })
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
      const body = await apiFetch<InspectionDetail>(`/api/inspections/${id}`);
      setDetail(body.data);
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "刷新失败", "NETWORK_ERROR"),
      );
    }
  };

  const handleComplete = async () => {
    if (!detail || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    setCompleteOpen(false);
    try {
      await apiFetch(`/api/inspections/${id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: detail.version,
          ...(qualifiedQty !== "" ? { qualifiedQty: Number(qualifiedQty) } : {}),
          ...(rejectedQty !== "" ? { rejectedQty: Number(rejectedQty) } : {}),
        }),
      });
      await refreshDetail();
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "质检完成失败", "NETWORK_ERROR"),
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
        <Link href="/purchasing/inspections" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          返回列表
        </Link>
      </AppPage>
    );
  }

  const src = detail.purchaseReceiptLine;

  return (
    <AppPage>
      {actionError && (
        <div className="border-status-danger-border mb-3 rounded-md border bg-status-danger-bg/10 p-3 text-sm text-status-danger-text">
          {describeStatus(actionError.status)}：{actionError.message}
          {actionError.code ? `（${actionError.code}）` : ""}
        </div>
      )}
      <EntityDetailWorkspace
        title={`质检记录详情 — ${detail.inspectionMode}`}
        backHref="/purchasing/inspections"
        status={detail.result}
        actions={
          detail.result === "PENDING" && canEdit ? (
            <>
              <Link
                href={`/purchasing/inspections/${id}/edit`}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-primary hover:bg-slate-50"
              >
                编辑
              </Link>
              <button
                type="button"
                onClick={() => {
                  setQualifiedQty(detail.qualifiedQty);
                  setRejectedQty(detail.rejectedQty);
                  setCompleteOpen(true);
                }}
                disabled={actionBusy}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionBusy ? "处理中…" : "完成质检"}
              </button>
            </>
          ) : undefined
        }
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="质检模式" value={detail.inspectionMode} />
            <InfoItem label="合格数量" value={detail.qualifiedQty} />
            <InfoItem label="拒收数量" value={detail.rejectedQty} />
            <InfoItem label="质检人" value={detail.inspectedBy?.name} />
            <InfoItem label="质检时间" value={formatDate(detail.inspectedAt)} />
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
            <InfoItem label="备注" value={detail.remark} />
          </div>
        }
      >
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">来源收货行</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem
              label="收货单"
              value={
                src?.purchaseReceipt?.code
                  ? `${src.purchaseReceipt.code}${src.purchaseReceipt.status ? `（${src.purchaseReceipt.status}）` : ""}`
                  : null
              }
            />
            <InfoItem label="行号" value={src?.lineNo} />
            <InfoItem
              label="物料"
              value={src?.item ? `${src.item.code ?? ""} ${src.item.name ?? ""}`.trim() : null}
            />
            <InfoItem label="单位" value={src?.uom?.symbol} />
            <InfoItem label="到货数量" value={src?.quantity} />
            <InfoItem label="现场拒收" value={src?.rejectedOnReceiptQty ?? "0"} />
            <InfoItem label="可见损坏" value={src?.visibleDamageQty ?? "0"} />
            <InfoItem
              label="PO 行"
              value={
                src?.purchaseOrderLine
                  ? `L${src.purchaseOrderLine.lineNo ?? ""}（${src.purchaseOrderLine.fulfillmentType ?? ""}）`
                  : null
              }
            />
          </div>
        </section>
      </EntityDetailWorkspace>

      {/* ── 完成质检对话框（合格/拒收数量） ── */}
      {completeOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setCompleteOpen(false)}
        >
          <div
            className="border-border bg-surface shadow-elevation-lg w-full max-w-md rounded-lg border p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-ink-primary text-base font-semibold">完成质检</h2>
            <p className="text-ink-secondary mt-2 text-xs">
              合格数量 + 拒收数量 = 可检数量（SKIP 免检由服务端强制 QUALIFIED）。
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <label className="block text-xs text-slate-500">合格数量</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={qualifiedQty}
                  onChange={(e) => setQualifiedQty(e.target.value)}
                  className="focus:border-brand-500 mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500">拒收数量</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={rejectedQty}
                  onChange={(e) => setRejectedQty(e.target.value)}
                  className="focus:border-brand-500 mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 focus:outline-none"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCompleteOpen(false)}
                disabled={actionBusy}
                className="border-border text-ink-secondary rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleComplete}
                disabled={actionBusy}
                className="bg-brand-600 hover:bg-brand-700 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionBusy ? "完成中…" : "确认完成"}
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
    <PermissionGuard permission={PERMISSIONS.INSPECTION_READ}>
      <InspectionDetailPage />
    </PermissionGuard>
  );
}
