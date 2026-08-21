"use client";

/**
 * Purchase Requisitions — 采购申请详情页（F2-3 Batch C1 Consolidation，CTO #11888）
 *
 * 由旧式布局迁移至统一 Workspace：
 * AppPage → EntityDetailWorkspace（Header Summary → Status → Actions → Sections → Audit）。
 * 不改 backend / 状态机 / action；apiFetch 数据加载原样保留。
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
  SUBMITTED: "已提交",
  APPROVED: "已批准",
  CONVERTED: "已转采购订单",
  CANCELLED: "已取消",
};

interface RequisitionDetail {
  id: string;
  code: string;
  status: string;
  remark?: string | null;
  needDate?: string | null;
  createdAt: string;
  requester?: { name: string | null } | null;
  department?: { name: string | null } | null;
  lines?: Array<{
    id: string;
    lineNo: number;
    description: string;
    quantity: string;
    needDate?: string | null;
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

function RequisitionDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const { state } = useSession();
  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canEdit = hasPermission(roles, actionPermission("purchase-requisition", "edit"));
  const canApprove = hasPermission(roles, actionPermission("purchase-requisition", "approve"));
  const [detail, setDetail] = useState<RequisitionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiClientError | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; code: string | null; name: string | null }>>([]);
  const [convertSupplierId, setConvertSupplierId] = useState("");
  const [convertDeliveryDate, setConvertDeliveryDate] = useState("");
  const [convertPaymentTerm, setConvertPaymentTerm] = useState("");
  const [convertRemark, setConvertRemark] = useState("");
  const [convertError, setConvertError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<RequisitionDetail>(`/api/purchase-requisitions/${id}`, { signal: controller.signal })
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
      const body = await apiFetch<RequisitionDetail>(`/api/purchase-requisitions/${id}`);
      setDetail(body.data);
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "刷新失败", "NETWORK_ERROR"),
      );
    }
  };

  const handleSubmit = async () => {
    if (!detail || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await apiFetch(`/api/purchase-requisitions/${id}/submit`, { method: "POST" });
      await refreshDetail();
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "提交失败", "NETWORK_ERROR"),
      );
    } finally {
      setActionBusy(false);
    }
  };

  const openConvertDialog = async () => {
    setConvertOpen(true);
    setConvertError(null);
    setConvertSupplierId("");
    setConvertDeliveryDate("");
    setConvertPaymentTerm("");
    setConvertRemark("");
    try {
      const body = await apiFetch<Array<{ id: string; code: string | null; name: string | null }>>("/api/suppliers?pageSize=100");
      setSuppliers(body.data);
    } catch {
      setConvertError("加载供应商失败");
    }
  };

  const handleConvert = async () => {
    if (!detail || actionBusy) return;
    if (!convertSupplierId) {
      setConvertError("请选择供应商");
      return;
    }
    setActionBusy(true);
    setActionError(null);
    setConvertError(null);
    setConvertOpen(false);
    try {
      const body = await apiFetch<{ id: string; code: string; status: string }>(
        `/api/purchase-requisitions/${id}/convert`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supplierId: convertSupplierId,
            ...(convertDeliveryDate ? { expectedDeliveryDate: new Date(convertDeliveryDate).toISOString() } : {}),
            ...(convertPaymentTerm.trim() ? { paymentTerm: convertPaymentTerm.trim() } : {}),
            ...(convertRemark.trim() ? { remark: convertRemark.trim() } : {}),
          }),
        },
      );
      await refreshDetail();
      if (body.data.id) {
        window.location.href = `/purchasing/orders/${body.data.id}`;
      }
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "转单失败", "NETWORK_ERROR"),
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
        <Link href="/purchasing/requisitions" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
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
        title={`采购申请详情 — ${detail.code}`}
        backHref="/purchasing/requisitions"
        status={detail.status}
        statusLabel={STATUS_LABELS[detail.status] ?? detail.status}
        actions={
          <>
            {detail.status === "DRAFT" && canEdit && (
              <>
                <Link
                  href={`/purchasing/requisitions/${id}/edit`}
                  className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-primary hover:bg-canvas"
                >
                  编辑
                </Link>
                <button
                  type="button"
                  onClick={() => setConfirmSubmit(true)}
                  disabled={actionBusy}
                  className={BUTTON_PRIMARY_CLASS}
                >
                  {actionBusy ? "处理中…" : "提交审批"}
                </button>
              </>
            )}
            {detail.status === "APPROVED" && canApprove && (
              <button
                type="button"
                onClick={openConvertDialog}
                disabled={actionBusy}
                className={BUTTON_PRIMARY_CLASS}
              >
                {actionBusy ? "处理中…" : "转采购订单"}
              </button>
            )}
          </>
        }
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="单号" value={detail.code} />
            <InfoItem label="申请人" value={detail.requester?.name} />
            <InfoItem label="部门" value={detail.department?.name} />
            <InfoItem label="需求日期" value={formatDate(detail.needDate)} />
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
                  <th className="px-3 py-2 font-medium">需求描述</th>
                  <th className="px-3 py-2 font-medium">数量</th>
                  <th className="px-3 py-2 font-medium">单位</th>
                  <th className="px-3 py-2 font-medium">需求日期</th>
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
                    <td className="px-3 py-2 text-ink-secondary">{formatDate(line.needDate)}</td>
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
          </div>
        </section>
      </EntityDetailWorkspace>

      <ConfirmActionDialog
        open={confirmSubmit}
        title="提交采购申请审批"
        description="提交后进入审批流程（命中策略需 APPROVED 后才能转采购订单）。确认提交？"
        confirmLabel="确认提交"
        busy={actionBusy}
        onConfirm={() => {
          setConfirmSubmit(false);
          void handleSubmit();
        }}
        onCancel={() => setConfirmSubmit(false)}
      />

      {/* ── 转采购订单对话框（选择供应商 + 可选头字段；行自动复制 PR 行） ── */}
      {convertOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setConvertOpen(false)}
        >
          <div
            className="border-border bg-surface shadow-elevation-lg w-full max-w-md rounded-lg border p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-ink-primary text-base font-semibold">转采购订单</h2>
            <p className="text-ink-secondary mt-2 text-xs">将采购申请行复制为采购订单（DRAFT）；请选择供应商。</p>
            {convertError && (
              <div className="border-status-danger-border mt-3 rounded-md border bg-status-danger-bg p-2 text-sm text-status-danger-text">{convertError}</div>
            )}
            <div className="mt-4 space-y-3 text-sm">
              <div>
                <label className="block text-xs text-ink-secondary">供应商 *</label>
                <select
                  value={convertSupplierId}
                  onChange={(e) => setConvertSupplierId(e.target.value)}
                  className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
                >
                  <option value="">选择供应商</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.code ?? ""} {s.name ?? ""}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-ink-secondary">期望交期（可选）</label>
                <input
                  type="datetime-local"
                  value={convertDeliveryDate}
                  onChange={(e) => setConvertDeliveryDate(e.target.value)}
                  className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-ink-secondary">付款条件（可选，≤100）</label>
                <input
                  value={convertPaymentTerm}
                  onChange={(e) => setConvertPaymentTerm(e.target.value)}
                  maxLength={100}
                  className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-ink-secondary">备注（可选，≤1000）</label>
                <input
                  value={convertRemark}
                  onChange={(e) => setConvertRemark(e.target.value)}
                  maxLength={1000}
                  className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConvertOpen(false)}
                disabled={actionBusy}
                className="border-border text-ink-secondary rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConvert}
                disabled={actionBusy}
                className="bg-brand-600 hover:bg-brand-700 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionBusy ? "转单中…" : "确认转单"}
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
    <PermissionGuard permission={PERMISSIONS.PURCHASE_REQUISITION_READ}>
      <RequisitionDetailPage />
    </PermissionGuard>
  );
}