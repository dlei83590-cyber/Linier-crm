"use client";

/**
 * Inventory Transfers — 库存调拨详情页（F2-3 Batch C2 Consolidation + F2-6B 批 3 动作）
 *
 * AppPage → EntityDetailWorkspace（Header Summary → Actions → Lines）。
 * F2-6B 批 3：状态 Gate + 权限 Gate 后提供 submit / execute / cancel 事实动作。
 *  - submit（inventory-transfer:edit）：DRAFT → SUBMITTED（version CAS）
 *  - execute（inventory-transfer:edit）：APPROVED → EXECUTED（version CAS，幂等 ALREADY_EXECUTED）
 *  - cancel（inventory-transfer:close）：DRAFT/APPROVED → CANCELLED（version CAS）
 * APPROVED ≠ EXECUTED；SUBMITTED 状态走 Workflow 审批（前端不驱动审批）。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { AppPage, ConfirmActionDialog, EntityDetailWorkspace, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { formatDate } from "@/lib/format";

interface TransferDetail {
  id: string;
  version: number;
  transferNo: string;
  status: string;
  transferType?: string | null;
  movementGroupId?: string | null;
  remark?: string | null;
  createdAt: string;
  executedAt?: string | null;
  sourceWarehouse?: { name: string | null } | null;
  sourceLocation?: { name: string | null } | null;
  destinationWarehouse?: { name: string | null } | null;
  destinationLocation?: { name: string | null } | null;
  approvedBy?: { name: string | null } | null;
  executedBy?: { name: string | null } | null;
  lines?: Array<{
    id: string;
    quantity: string;
    batchNo?: string | null;
    remark?: string | null;
    item?: { code: string | null; name: string | null } | null;
    uom?: { symbol: string | null } | null;
  }>;
}

type ConfirmAction = "submit" | "execute" | "cancel";

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
}

function TransferDetailPage() {
  const { state } = useSession();
  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canEdit = hasPermission(roles, actionPermission("inventory-transfer", "edit"));
  const canClose = hasPermission(roles, actionPermission("inventory-transfer", "close"));
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<TransferDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiClientError | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<TransferDetail>(`/api/inventory-transfers/${id}`, { signal: controller.signal })
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
      const body = await apiFetch<TransferDetail>(`/api/inventory-transfers/${id}`);
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
      await apiFetch(`/api/inventory-transfers/${id}/${action}`, {
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
        <Link href="/inventory/transfers" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
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
        title={`库存调拨详情 — ${detail.transferNo}`}
        backHref="/inventory/transfers"
        status={detail.status}
        actions={
          <>
            {detail.status === "DRAFT" && canEdit && (
              <Link
                href={`/inventory/transfers/${id}/edit`}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-primary hover:bg-slate-50"
              >
                编辑
              </Link>
            )}
            {detail.status === "DRAFT" && canEdit && (
              <button
                type="button"
                onClick={() => setConfirmAction("submit")}
                disabled={actionBusy}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionBusy ? "处理中…" : "提交"}
              </button>
            )}
            {detail.status === "APPROVED" && canEdit && (
              <button
                type="button"
                onClick={() => setConfirmAction("execute")}
                disabled={actionBusy}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionBusy ? "执行中…" : "执行调拨"}
              </button>
            )}
            {(detail.status === "DRAFT" || detail.status === "APPROVED") && canClose && (
              <button
                type="button"
                onClick={() => setConfirmAction("cancel")}
                disabled={actionBusy}
                className="rounded-md border border-status-danger-border bg-surface px-3 py-1.5 text-sm font-medium text-status-danger-text hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
            )}
          </>
        }
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="调拨单号" value={detail.transferNo} />
            <InfoItem label="调拨类型" value={detail.transferType} />
            <InfoItem label="Movement Group" value={detail.movementGroupId} />
            <InfoItem
              label="源仓库"
              value={
                detail.sourceWarehouse?.name
                  ? `${detail.sourceWarehouse.name}${detail.sourceLocation ? ` / ${detail.sourceLocation.name}` : ""}`
                  : null
              }
            />
            <InfoItem
              label="目标仓库"
              value={
                detail.destinationWarehouse?.name
                  ? `${detail.destinationWarehouse.name}${detail.destinationLocation ? ` / ${detail.destinationLocation.name}` : ""}`
                  : null
              }
            />
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
            <InfoItem label="执行时间" value={formatDate(detail.executedAt)} />
            <InfoItem label="执行人" value={detail.executedBy?.name} />
            <InfoItem label="备注" value={detail.remark} />
          </div>
        }
      >
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">
            调拨行（{detail.lines?.length ?? 0}）
          </h2>
          <div className="overflow-x-auto">
            <table className="divide-border min-w-full divide-y text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium text-ink-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">物料</th>
                  <th className="px-3 py-2 font-medium">数量</th>
                  <th className="px-3 py-2 font-medium">单位</th>
                  <th className="px-3 py-2 font-medium">批次</th>
                  <th className="px-3 py-2 font-medium">备注</th>
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
                    <td className="px-3 py-2 text-ink-secondary">{line.remark ?? "—"}</td>
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
        open={confirmAction !== null}
        title={
          confirmAction === "submit"
            ? "提交调拨单"
            : confirmAction === "execute"
              ? "执行调拨"
              : "取消调拨单"
        }
        description={
          confirmAction === "submit"
            ? "提交后进入审批流程（命中策略则需 APPROVED 后方可执行）。确认提交？"
            : confirmAction === "execute"
              ? "执行将产生双边库存流水（SOURCE_OUT + DESTINATION_IN，同事务原子提交），不可逆。确认执行？"
              : "取消该调拨单？仅 DRAFT/APPROVED 可取消。确认后不可恢复。"
        }
        confirmLabel={confirmAction === "execute" ? "确认执行" : confirmAction === "cancel" ? "确认取消" : "确认提交"}
        tone={confirmAction === "cancel" ? "danger" : confirmAction === "execute" ? "danger" : "primary"}
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
    <PermissionGuard permission={PERMISSIONS.INVENTORY_TRANSFER_READ}>
      <TransferDetailPage />
    </PermissionGuard>
  );
}
