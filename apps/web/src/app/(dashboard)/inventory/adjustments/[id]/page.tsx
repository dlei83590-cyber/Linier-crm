"use client";

/**
 * Inventory Adjustments — 库存调整详情页（F2-3 Consolidation + F2-6B 批 3 动作）
 *
 * F2-6B 批 3：状态 Gate + 权限 Gate 后提供 submit / apply / cancel 事实动作。
 *  - submit（inventory-adjustment:edit）：DRAFT → SUBMITTED（version CAS）
 *  - apply（inventory-adjustment:apply，受限系统权限）：APPROVED → APPLIED（version CAS，maker-checker）
 *  - cancel（inventory-adjustment:close）：DRAFT/SUBMITTED/APPROVED → CANCELLED
 * APPROVED ≠ APPLIED；库存落账由后端 Shared LedgerCommand 执行（前端只读）。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { AppPage, ConfirmActionDialog, EntityDetailWorkspace, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS } from "@/lib/ui-classes";
import { formatDate } from "@/lib/format";

interface AdjustmentDetail {
  id: string;
  version: number;
  adjustmentNo: string;
  status: string;
  reasonCode: string;
  appliedAt?: string | null;
  remark?: string | null;
  createdAt: string;
  sourceStockCount?: { countNo: string | null; status: string | null } | null;
  approvedBy?: { name: string | null } | null;
  appliedBy?: { name: string | null } | null;
  lines?: Array<{
    id: string;
    direction: string;
    quantity: string;
    batchNo?: string | null;
    serialNo?: string | null;
    item?: { code: string | null; name: string | null } | null;
    uom?: { symbol: string | null } | null;
    warehouse?: { name: string | null } | null;
    location?: { name: string | null } | null;
  }>;
}

type ConfirmAction = "submit" | "apply" | "cancel";

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
}

function AdjustmentDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const { state } = useSession();
  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canEdit = hasPermission(roles, actionPermission("inventory-adjustment", "edit"));
  const canApply = hasPermission(roles, actionPermission("inventory-adjustment", "apply"));
  const canClose = hasPermission(roles, actionPermission("inventory-adjustment", "close"));
  const [detail, setDetail] = useState<AdjustmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiClientError | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<AdjustmentDetail>(`/api/inventory-adjustments/${id}`, { signal: controller.signal })
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
      const body = await apiFetch<AdjustmentDetail>(`/api/inventory-adjustments/${id}`);
      setDetail(body.data);
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "刷新失败", "NETWORK_ERROR"),
      );
    }
  };

  const runAction = async (action: ConfirmAction) => {
    if (!detail || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await apiFetch(`/api/inventory-adjustments/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: detail.version }),
      });
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
        <div className="border-border bg-surface rounded-lg border p-6 text-sm text-ink-muted">加载中…</div>
      </AppPage>
    );
  }

  if (error || !detail) {
    return (
      <AppPage>
        <ErrorPanel error={error} />
        <Link href="/inventory/adjustments" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
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
        title={`库存调整详情 — ${detail.adjustmentNo}`}
        backHref="/inventory/adjustments"
        status={detail.status}
        actions={
          <>
            {detail.status === "DRAFT" && canEdit && (
              <Link
                href={`/inventory/adjustments/${id}/edit`}
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
                {actionBusy ? "处理中…" : "提交"}
              </button>
            )}
            {detail.status === "APPROVED" && canApply && (
              <button
                type="button"
                onClick={() => setConfirmAction("apply")}
                disabled={actionBusy}
                className={BUTTON_PRIMARY_CLASS}
              >
                {actionBusy ? "应用中…" : "应用调整"}
              </button>
            )}
            {(detail.status === "DRAFT" || detail.status === "SUBMITTED" || detail.status === "APPROVED") && canClose && (
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
            <InfoItem label="调整单号" value={detail.adjustmentNo} />
            <InfoItem label="原因码" value={detail.reasonCode} />
            <InfoItem
              label="来源盘点"
              value={
                detail.sourceStockCount?.countNo
                  ? `${detail.sourceStockCount.countNo}${detail.sourceStockCount.status ? `（${detail.sourceStockCount.status}）` : ""}`
                  : null
              }
            />
            <InfoItem label="审批人" value={detail.approvedBy?.name} />
            <InfoItem label="应用人" value={detail.appliedBy?.name} />
            <InfoItem label="应用时间" value={formatDate(detail.appliedAt)} />
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
            <InfoItem label="备注" value={detail.remark} />
          </div>
        }
      >
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">
            调整行（{detail.lines?.length ?? 0}）
          </h2>
          <div className="overflow-x-auto">
            <table className="divide-border min-w-full divide-y text-sm">
              <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">仓库</th>
                  <th className="px-3 py-2 font-medium">库位</th>
                  <th className="px-3 py-2 font-medium">物料</th>
                  <th className="px-3 py-2 font-medium">方向</th>
                  <th className="px-3 py-2 font-medium">数量</th>
                  <th className="px-3 py-2 font-medium">单位</th>
                  <th className="px-3 py-2 font-medium">批次/序列号</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {(detail.lines ?? []).map((line) => (
                  <tr key={line.id}>
                    <td className="px-3 py-2 text-ink-secondary">{line.warehouse?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{line.location?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-primary">
                      {line.item ? `${line.item.code ?? ""} ${line.item.name ?? ""}`.trim() : "—"}
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{line.direction}</td>
                    <td className="px-3 py-2 text-ink-primary">{line.quantity}</td>
                    <td className="px-3 py-2 text-ink-secondary">{line.uom?.symbol ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{line.batchNo ?? line.serialNo ?? "—"}</td>
                  </tr>
                ))}
                {(detail.lines ?? []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-sm text-ink-muted">暂无明细行</td>
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
          confirmAction === "submit" ? "提交调整单" : confirmAction === "apply" ? "应用调整" : "取消调整单"
        }
        description={
          confirmAction === "submit"
            ? "提交即生效（已自动批准），可继续应用。确认提交？"
            : confirmAction === "apply"
              ? "应用将经 Shared LedgerCommand 追加库存流水（IN/OUT 同事务落账），不可逆。确认应用？"
              : "取消该调整单？仅 DRAFT/SUBMITTED/APPROVED 可取消（APPLIED 禁止取消）。"
        }
        confirmLabel={confirmAction === "apply" ? "确认应用" : confirmAction === "cancel" ? "确认取消" : "确认提交"}
        tone={confirmAction === "apply" || confirmAction === "cancel" ? "danger" : "primary"}
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
    <PermissionGuard permission={PERMISSIONS.INVENTORY_ADJUSTMENT_READ}>
      <AdjustmentDetailPage />
    </PermissionGuard>
  );
}