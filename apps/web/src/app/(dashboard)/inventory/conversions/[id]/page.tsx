"use client";

/**
 * Inventory Conversions — 库存转换详情页（F2-3 Consolidation + F2-6B 批 3 动作）
 *
 * F2-6B 批 3：状态 Gate + 权限 Gate 后提供 submit / execute / cancel 事实动作。
 *  - submit（inventory-conversion:edit）：DRAFT → SUBMITTED（version CAS；Conversion 无审批状态）
 *  - execute（inventory-conversion:edit）：SUBMITTED → EXECUTED（version CAS，幂等 ALREADY_EXECUTED）
 *  - cancel（inventory-conversion:close）：DRAFT/SUBMITTED → CANCELLED
 * SUBMITTED ≠ EXECUTED；CONSUME/PRODUCE 守恒由后端 Shared LedgerCommand 校验。
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

interface ConversionDetail {
  id: string;
  version: number;
  conversionNo: string;
  status: string;
  movementGroupId?: string | null;
  executedAt?: string | null;
  remark?: string | null;
  createdAt: string;
  item?: { code: string | null; name: string | null } | null;
  baseUom?: { symbol: string | null } | null;
  executedBy?: { name: string | null } | null;
  lines?: Array<{
    id: string;
    lineRole: string;
    quantity: string;
    uomToBaseRate: string;
    baseQuantity: string;
    batchNo?: string | null;
    item?: { code: string | null; name: string | null } | null;
    uom?: { symbol: string | null } | null;
    warehouse?: { name: string | null } | null;
    location?: { name: string | null } | null;
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

function ConversionDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const { state } = useSession();
  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canEdit = hasPermission(roles, actionPermission("inventory-conversion", "edit"));
  const canClose = hasPermission(roles, actionPermission("inventory-conversion", "close"));
  const [detail, setDetail] = useState<ConversionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiClientError | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<ConversionDetail>(`/api/inventory-conversions/${id}`, { signal: controller.signal })
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
      const body = await apiFetch<ConversionDetail>(`/api/inventory-conversions/${id}`);
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
      await apiFetch(`/api/inventory-conversions/${id}/${action}`, {
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
        <Link href="/inventory/conversions" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
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
        title={`库存转换详情 — ${detail.conversionNo}`}
        backHref="/inventory/conversions"
        status={detail.status}
        actions={
          <>
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
            {detail.status === "SUBMITTED" && canEdit && (
              <button
                type="button"
                onClick={() => setConfirmAction("execute")}
                disabled={actionBusy}
                className={BUTTON_PRIMARY_CLASS}
              >
                {actionBusy ? "执行中…" : "执行转换"}
              </button>
            )}
            {(detail.status === "DRAFT" || detail.status === "SUBMITTED") && canClose && (
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
            <InfoItem label="转换单号" value={detail.conversionNo} />
            <InfoItem
              label="物料"
              value={detail.item ? `${detail.item.code ?? ""} ${detail.item.name ?? ""}`.trim() : null}
            />
            <InfoItem label="基准单位" value={detail.baseUom?.symbol} />
            <InfoItem label="执行人" value={detail.executedBy?.name} />
            <InfoItem label="执行时间" value={formatDate(detail.executedAt)} />
            <InfoItem label="Movement Group" value={detail.movementGroupId} />
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
            <InfoItem label="备注" value={detail.remark} />
          </div>
        }
      >
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">
            转换行（{detail.lines?.length ?? 0}）
          </h2>
          <div className="overflow-x-auto">
            <table className="divide-border min-w-full divide-y text-sm">
              <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">行角色</th>
                  <th className="px-3 py-2 font-medium">物料</th>
                  <th className="px-3 py-2 font-medium">数量</th>
                  <th className="px-3 py-2 font-medium">单位</th>
                  <th className="px-3 py-2 font-medium">换算率</th>
                  <th className="px-3 py-2 font-medium">基准数量</th>
                  <th className="px-3 py-2 font-medium">仓库</th>
                  <th className="px-3 py-2 font-medium">库位</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {(detail.lines ?? []).map((line) => (
                  <tr key={line.id}>
                    <td className="px-3 py-2 text-ink-secondary">{line.lineRole}</td>
                    <td className="px-3 py-2 text-ink-primary">
                      {line.item ? `${line.item.code ?? ""} ${line.item.name ?? ""}`.trim() : "—"}
                    </td>
                    <td className="px-3 py-2 text-ink-primary">{line.quantity}</td>
                    <td className="px-3 py-2 text-ink-secondary">{line.uom?.symbol ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{line.uomToBaseRate}</td>
                    <td className="px-3 py-2 text-ink-primary">{line.baseQuantity}</td>
                    <td className="px-3 py-2 text-ink-secondary">{line.warehouse?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{line.location?.name ?? "—"}</td>
                  </tr>
                ))}
                {(detail.lines ?? []).length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-sm text-ink-muted">暂无明细行</td>
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
          confirmAction === "submit" ? "提交转换单" : confirmAction === "execute" ? "执行转换" : "取消转换单"
        }
        description={
          confirmAction === "submit"
            ? "提交转换单（Conversion 无审批状态，提交即确认）。确认提交？"
            : confirmAction === "execute"
              ? "执行将产生 CONSUME + PRODUCE 双边库存流水（守恒校验，同事务原子提交），不可逆。确认执行？"
              : "取消该转换单？仅 DRAFT/SUBMITTED 可取消。确认后不可恢复。"
        }
        confirmLabel={confirmAction === "execute" ? "确认执行" : confirmAction === "cancel" ? "确认取消" : "确认提交"}
        tone={confirmAction === "execute" || confirmAction === "cancel" ? "danger" : "primary"}
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
    <PermissionGuard permission={PERMISSIONS.INVENTORY_CONVERSION_READ}>
      <ConversionDetailPage />
    </PermissionGuard>
  );
}