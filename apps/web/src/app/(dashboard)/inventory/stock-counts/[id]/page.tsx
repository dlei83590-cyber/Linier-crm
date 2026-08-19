"use client";

/**
 * Stock Counts — 库存盘点详情页（F2-3 Consolidation + F2-6B 批 3 动作）
 *
 * F2-6B 批 3：状态 Gate + 权限 Gate 后提供：
 *  - 录入盘点行（stock-count:edit）：DRAFT/COUNTING，逐行录入（服务端冻结五维快照并计算差异）
 *  - 完成盘点（stock-count:edit）：COUNTING → COMPLETED（零差异）/ ADJUSTED（非零差异自动生成调整单）
 *  - 取消（stock-count:close）：DRAFT/COUNTING → CANCELLED
 * version CAS 由后端执行；差异/账面数量为服务端事实，前端只读。
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

interface StockCountDetail {
  id: string;
  version: number;
  countNo: string;
  status: string;
  completedAt?: string | null;
  remark?: string | null;
  createdAt: string;
  countedBy?: { name: string | null } | null;
  lines?: Array<{
    id: string;
    countedQty: string;
    bookQtyAtCount: string;
    varianceQty?: string | null;
    batchNo?: string | null;
    serialNo?: string | null;
    item?: { code: string | null; name: string | null } | null;
    warehouse?: { name: string | null } | null;
    location?: { name: string | null } | null;
  }>;
}

interface WarehouseOption {
  id: string;
  name: string | null;
  code: string | null;
}
interface LocationOption {
  id: string;
  name: string | null;
  code: string | null;
  warehouseId?: string | null;
}
interface ItemOption {
  id: string;
  code: string | null;
  name: string | null;
}

type ConfirmAction = "complete" | "cancel";

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
}

function StockCountDetailPage() {
  const { state } = useSession();
  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canEdit = hasPermission(roles, actionPermission("stock-count", "edit"));
  const canClose = hasPermission(roles, actionPermission("stock-count", "close"));
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<StockCountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiClientError | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  // 录入行 dialog
  const [lineOpen, setLineOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [lineLoading, setLineLoading] = useState(false);
  const [lineForm, setLineForm] = useState({
    warehouseId: "",
    locationId: "",
    itemId: "",
    batchNo: "",
    serialNo: "",
    countedQty: "",
    remark: "",
  });
  const [lineError, setLineError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<StockCountDetail>(`/api/stock-counts/${id}`, { signal: controller.signal })
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
      const body = await apiFetch<StockCountDetail>(`/api/stock-counts/${id}`);
      setDetail(body.data);
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "刷新失败", "NETWORK_ERROR"),
      );
    }
  };

  const openLineDialog = async () => {
    setLineOpen(true);
    setLineError(null);
    setLineLoading(true);
    setLineForm({ warehouseId: "", locationId: "", itemId: "", batchNo: "", serialNo: "", countedQty: "", remark: "" });
    try {
      const [w, l, it] = await Promise.all([
        apiFetch<WarehouseOption[]>("/api/warehouses?pageSize=100"),
        apiFetch<LocationOption[]>("/api/warehouse-locations?pageSize=100"),
        apiFetch<ItemOption[]>("/api/items?pageSize=100"),
      ]);
      setWarehouses(w.data);
      setLocations(l.data);
      setItems(it.data);
    } catch {
      setLineError("加载基础数据失败");
    } finally {
      setLineLoading(false);
    }
  };

  const handleAddLine = async () => {
    if (!detail || actionBusy) return;
    if (!lineForm.warehouseId || !lineForm.itemId) {
      setLineError("请选择仓库与物料");
      return;
    }
    if (lineForm.countedQty === "" || Number(lineForm.countedQty) < 0) {
      setLineError("实盘数量必须 >= 0");
      return;
    }
    setActionBusy(true);
    setActionError(null);
    setLineError(null);
    try {
      await apiFetch(`/api/stock-counts/${id}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: [
            {
              warehouseId: lineForm.warehouseId,
              ...(lineForm.locationId ? { locationId: lineForm.locationId } : {}),
              itemId: lineForm.itemId,
              ...(lineForm.batchNo.trim() ? { batchNo: lineForm.batchNo.trim() } : {}),
              ...(lineForm.serialNo.trim() ? { serialNo: lineForm.serialNo.trim() } : {}),
              countedQty: Number(lineForm.countedQty),
              ...(lineForm.remark.trim() ? { remark: lineForm.remark.trim() } : {}),
            },
          ],
        }),
      });
      setLineOpen(false);
      await refreshDetail();
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "录入失败", "NETWORK_ERROR"),
      );
    } finally {
      setActionBusy(false);
    }
  };

  const runAction = async (action: ConfirmAction) => {
    if (!detail || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await apiFetch(`/api/stock-counts/${id}/${action}`, {
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
        <Link href="/inventory/stock-counts" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
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
        title={`库存盘点详情 — ${detail.countNo}`}
        backHref="/inventory/stock-counts"
        status={detail.status}
        actions={
          <>
            {(detail.status === "DRAFT" || detail.status === "COUNTING") && canEdit && (
              <button
                type="button"
                onClick={openLineDialog}
                disabled={actionBusy}
                className={BUTTON_PRIMARY_CLASS}
              >
                录入盘点行
              </button>
            )}
            {detail.status === "COUNTING" && canEdit && (
              <button
                type="button"
                onClick={() => setConfirmAction("complete")}
                disabled={actionBusy}
                className={BUTTON_PRIMARY_CLASS}
              >
                完成盘点
              </button>
            )}
            {(detail.status === "DRAFT" || detail.status === "COUNTING") && canClose && (
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
            <InfoItem label="盘点单号" value={detail.countNo} />
            <InfoItem label="盘点人" value={detail.countedBy?.name} />
            <InfoItem label="完成时间" value={formatDate(detail.completedAt)} />
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
            <InfoItem label="备注" value={detail.remark} />
          </div>
        }
      >
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">
            盘点行（{detail.lines?.length ?? 0}）
          </h2>
          <div className="overflow-x-auto">
            <table className="divide-border min-w-full divide-y text-sm">
              <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">仓库</th>
                  <th className="px-3 py-2 font-medium">库位</th>
                  <th className="px-3 py-2 font-medium">物料</th>
                  <th className="px-3 py-2 font-medium">批次/序列号</th>
                  <th className="px-3 py-2 font-medium">实盘数量</th>
                  <th className="px-3 py-2 font-medium">账面数量</th>
                  <th className="px-3 py-2 font-medium">差异</th>
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
                    <td className="px-3 py-2 text-ink-secondary">{line.batchNo ?? line.serialNo ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-primary">{line.countedQty}</td>
                    <td className="px-3 py-2 text-ink-primary">{line.bookQtyAtCount}</td>
                    <td className="px-3 py-2 text-ink-primary">{line.varianceQty ?? "—"}</td>
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
        title={confirmAction === "complete" ? "完成盘点" : "取消盘点"}
        description={
          confirmAction === "complete"
            ? "完成盘点将冻结差异（非零差异自动生成库存调整单，需审批后落账）。确认完成？"
            : "取消该盘点单？仅 DRAFT/COUNTING 可取消。确认后不可恢复。"
        }
        confirmLabel={confirmAction === "complete" ? "确认完成" : "确认取消"}
        tone={confirmAction === "cancel" ? "danger" : "primary"}
        busy={actionBusy}
        onConfirm={() => {
          const a = confirmAction;
          setConfirmAction(null);
          if (a) void runAction(a);
        }}
        onCancel={() => setConfirmAction(null)}
      />

      {/* ── 录入盘点行 dialog ── */}
      {lineOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setLineOpen(false)}
        >
          <div
            className="border-border bg-surface shadow-elevation-lg w-full max-w-lg rounded-lg border p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-ink-primary text-base font-semibold">录入盘点行</h2>
            <p className="text-ink-secondary mt-2 text-xs">录入时服务端冻结账面数量快照并计算差异。</p>
            {lineError && (
              <div className="border-status-danger-border mt-3 rounded-md border bg-status-danger-bg p-2 text-sm text-status-danger-text">{lineError}</div>
            )}
            {lineLoading ? (
              <p className="text-ink-muted py-6 text-center text-sm">加载基础数据…</p>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <label className="block text-xs text-ink-secondary">仓库 *</label>
                  <select
                    value={lineForm.warehouseId}
                    onChange={(e) => setLineForm((f) => ({ ...f, warehouseId: e.target.value }))}
                    className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-2 py-1.5 focus:outline-none"
                  >
                    <option value="">选择仓库</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{w.code ?? ""} {w.name ?? ""}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-ink-secondary">库位（可选）</label>
                  <select
                    value={lineForm.locationId}
                    onChange={(e) => setLineForm((f) => ({ ...f, locationId: e.target.value }))}
                    className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-2 py-1.5 focus:outline-none"
                  >
                    <option value="">未指定</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>{l.code ?? ""} {l.name ?? ""}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-ink-secondary">物料 *</label>
                  <select
                    value={lineForm.itemId}
                    onChange={(e) => setLineForm((f) => ({ ...f, itemId: e.target.value }))}
                    className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-2 py-1.5 focus:outline-none"
                  >
                    <option value="">选择物料</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>{it.code ?? ""} {it.name ?? ""}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-ink-secondary">实盘数量 *</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={lineForm.countedQty}
                    onChange={(e) => setLineForm((f) => ({ ...f, countedQty: e.target.value }))}
                    className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-2 py-1.5 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-ink-secondary">批次（可选）</label>
                  <input
                    value={lineForm.batchNo}
                    onChange={(e) => setLineForm((f) => ({ ...f, batchNo: e.target.value }))}
                    maxLength={100}
                    className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-2 py-1.5 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-ink-secondary">序列号（可选）</label>
                  <input
                    value={lineForm.serialNo}
                    onChange={(e) => setLineForm((f) => ({ ...f, serialNo: e.target.value }))}
                    maxLength={100}
                    className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-2 py-1.5 focus:outline-none"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-ink-secondary">备注（可选）</label>
                  <input
                    value={lineForm.remark}
                    onChange={(e) => setLineForm((f) => ({ ...f, remark: e.target.value }))}
                    maxLength={500}
                    className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-2 py-1.5 focus:outline-none"
                  />
                </div>
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setLineOpen(false)}
                disabled={actionBusy}
                className="border-border text-ink-secondary rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-canvas"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleAddLine}
                disabled={actionBusy || lineLoading}
                className="bg-brand-600 hover:bg-brand-700 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionBusy ? "录入中…" : "录入"}
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
    <PermissionGuard permission={PERMISSIONS.STOCK_COUNT_READ}>
      <StockCountDetailPage />
    </PermissionGuard>
  );
}