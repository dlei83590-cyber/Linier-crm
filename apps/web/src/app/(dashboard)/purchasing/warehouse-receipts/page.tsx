"use client";

/**
 * Warehouse Receipts — 仓库收货列表页（F2-3 Batch C1 Consolidation，CTO #11888）
 *
 * 由旧式自绘 table/filter 迁移至统一 Workspace：
 * AppPage → EntityListWorkspace → StatusBadge / ErrorPanel / common toolbar。
 * 保留 Batch B2 的「+ 新建入库单」入口；不改 backend / 状态机 / action。
 */
import { useState } from "react";
import Link from "next/link";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge, ConfirmActionDialog } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";

interface WarehouseReceiptRow {
  id: string;
  code: string;
  status: string;
  postedAt?: string | null;
  purchaseReceipt?: { code: string | null } | null;
  warehouse?: { name: string | null } | null;
  location?: { name: string | null } | null;
  _count?: { lines: number };
  // 核销闭环：可退余额（POSTED 行 quantity - 已退；列表操作区退货按钮）
  returnableQty?: string;
}

interface ReturnLineDraft {
  id: string;
  label: string;
  maxQty: number;
  qty: string;
}

const STATUS_OPTIONS = ["DRAFT", "POSTED", "CANCELLED"] as const;

/** 状态中文业务名（Business UX Rationalization：枚举展示中文，不展示数据库枚举值；key 保留真实 enum） */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  POSTED: "已过账",
  CANCELLED: "已取消",
};

function WarehouseReceiptList() {
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("warehouse-receipt", "create"));
  const canEdit = hasPermission(state.user?.roles as RoleCode[], actionPermission("warehouse-receipt", "edit"));
  const canDelete = hasPermission(state.user?.roles as RoleCode[], actionPermission("warehouse-receipt", "delete"));
  const toast = useToast();
  const [deleting, setDeleting] = useState<WarehouseReceiptRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // 一键退货（列表操作区；全退/部分退）
  const [returnTarget, setReturnTarget] = useState<WarehouseReceiptRow | null>(null);
  const [returnLines, setReturnLines] = useState<ReturnLineDraft[]>([]);
  const [returnDisposition, setReturnDisposition] = useState("REPLACE_REQUIRED");
  const [returnBusy, setReturnBusy] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ code?: string; status?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<WarehouseReceiptRow>("/api/warehouse-receipts", filters);

  /** 打开退货对话框：拉详情行（可退余额）→ 默认全退（数量可改 = 部分退） */
  const openReturn = async (row: WarehouseReceiptRow) => {
    setReturnTarget(row);
    setReturnError(null);
    setReturnLines([]);
    try {
      const body = await apiFetch<{
        purchaseReceipt?: { id?: string | null; purchaseOrder?: { id?: string | null } | null } | null;
        lines?: Array<{ id: string; quantity: string; returnableQty?: string; item?: { code: string | null; name: string | null } | null; uom?: { symbol: string | null } | null }>;
      }>(`/api/warehouse-receipts/${row.id}`);
      const rows = (body.data.lines ?? []).filter((l) => Number(l.returnableQty ?? l.quantity ?? 0) > 0);
      setReturnLines(
        rows.map((l) => ({
          id: l.id,
          label: `${l.item?.code ?? ""} ${l.item?.name ?? ""}（可退 ${l.returnableQty ?? l.quantity}）`.trim(),
          maxQty: Number(l.returnableQty ?? l.quantity),
          qty: String(l.returnableQty ?? l.quantity), // 默认全退
        })),
      );
    } catch (err: unknown) {
      setReturnError(err instanceof ApiClientError ? err.message : "加载入库行失败");
    }
  };

  /** 提交一键退货（创建退货 → 完成退货 → 反收货） */
  const handleReturnSubmit = async () => {
    if (!returnTarget || returnBusy) return;
    const validLines = returnLines.filter((l) => Number(l.qty) > 0);
    if (validLines.length === 0) {
      setReturnError("请至少一行退货数量 > 0");
      return;
    }
    for (const l of validLines) {
      if (!Number.isFinite(Number(l.qty)) || Number(l.qty) <= 0 || Number(l.qty) > l.maxQty) {
        setReturnError(`第 ${validLines.indexOf(l) + 1} 行：退货数量必须在 (0, ${l.maxQty}]`);
        return;
      }
    }
    let poId = "";
    let rcId = "";
    try {
      const body = await apiFetch<{ purchaseReceipt?: { id?: string | null; purchaseOrder?: { id?: string | null } | null } | null }>(
        `/api/warehouse-receipts/${returnTarget.id}`,
      );
      poId = body.data.purchaseReceipt?.purchaseOrder?.id ?? "";
      rcId = body.data.purchaseReceipt?.id ?? "";
    } catch {
      setReturnError("加载来源信息失败");
      return;
    }
    if (!poId || !rcId) {
      setReturnError("缺少来源采购订单/收货单信息");
      return;
    }
    setReturnBusy(true);
    setReturnError(null);
    try {
      const created = await apiFetch<{ id: string }>("/api/purchase-returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchaseOrderId: poId,
          returnType: "RETURN_AFTER_STOCK_IN",
          remark: `仓库收货一键退货（入库单 ${returnTarget.code}）`,
          lines: validLines.map((l) => ({
            sourceRefType: "WAREHOUSE_RECEIPT_LINE",
            sourceWarehouseReceiptLineId: l.id,
            quantity: Number(l.qty),
            disposition: returnDisposition,
            returnReason: "仓库收货一键退货",
          })),
        }),
      });
      await apiFetch(`/api/purchase-returns/${created.data.id}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1 }),
      });
      await apiFetch(`/api/purchase-receipts/${rcId}/unreceive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changeReason: "仓库收货一键退货（含反收货）" }),
      });
      toast.success("退货并反收货完成");
      setReturnTarget(null);
      refresh();
    } catch (err: unknown) {
      const e = err instanceof ApiClientError ? err : new ApiClientError(0, "退货失败", "NETWORK_ERROR");
      setReturnError(e.message);
    } finally {
      setReturnBusy(false);
    }
  };
  const applyFilter = () => {
    const next: { code?: string; status?: string } = {};
    if (codeInput.trim()) next.code = codeInput.trim();
    if (statusInput) next.status = statusInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setCodeInput("");
    setStatusInput("");
    setFilters({});
    setPage(1);
  };

  const runDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await apiFetch("/api/warehouse-receipts/" + deleting.id, { method: "DELETE" });
      toast.success("入库单已删除");
      setDeleting(null);
      refresh();
    } catch (err: unknown) {
      const e = err instanceof ApiClientError ? err : new ApiClientError(0, "删除失败", "NETWORK_ERROR");
      toast.error("删除失败", e.message);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <AppPage>
      <EntityListWorkspace<WarehouseReceiptRow>
        title="仓库收货"
        description="仓库收货/入库工作台"
        emptyMessage="暂无仓库收货单——点击「+ 新建仓库收货单」创建第一张入库单"
        headerActions={
          canCreate ? (
            <Link
              href="/purchasing/warehouse-receipts/new"
              className={BUTTON_PRIMARY_CLASS}
            >
              + 新建入库单
            </Link>
          ) : undefined
        }
        filters={
          <>
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按入库单号搜索"
              className={"w-40 " + SELECT_CLASS}
            />
            <select
              value={statusInput}
              onChange={(e) => setStatusInput(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">全部状态</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s] ?? s}
                </option>
              ))}
            </select>
          </>
        }
        toolbarActions={
          <>
            <button
              type="button"
              onClick={applyFilter}
              className={BUTTON_PRIMARY_CLASS}
            >
              查询
            </button>
            <button
              type="button"
              onClick={resetFilter}
              className={BUTTON_SECONDARY_CLASS}
            >
              重置
            </button>
          </>
        }
        columns={[
          {
            key: "code",
            header: "入库单号",
            render: (row) => (
              <Link
                href={`/purchasing/warehouse-receipts/${row.id}`}
                className="font-medium text-brand-600 hover:underline"
              >
                {row.code}
              </Link>
            ),
          },
          {
            key: "status",
            header: "状态",
            render: (row) => (
              <StatusBadge status={row.status} label={STATUS_LABELS[row.status] ?? row.status} />
            ),
          },
          {
            key: "purchaseReceipt",
            header: "来源收货单",
            render: (row) => row.purchaseReceipt?.code ?? "—",
          },
          {
            key: "warehouse",
            header: "仓库",
            render: (row) => row.warehouse?.name ?? "—",
          },
          {
            key: "location",
            header: "库位",
            render: (row) => row.location?.name ?? "—",
          },
          {
            key: "lines",
            header: "行数",
            render: (row) => String(row._count?.lines ?? 0),
          },
          {
            key: "postedAt",
            header: "过账日期",
            render: (row) => formatDate(row.postedAt),
          },
          {
            key: "actions",
            header: "操作",
            render: (row) => (
              <div className="flex items-center gap-2">
                {canEdit && row.status === "POSTED" && Number(row.returnableQty ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => void openReturn(row)}
                    disabled={returnBusy || deleteBusy}
                    className="rounded-md border border-status-danger-border px-2 py-1 text-xs text-status-danger-text hover:bg-status-danger-bg/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    退货
                  </button>
                )}
                {canDelete && ["DRAFT", "CANCELLED"].includes(row.status) && (
                  <button
                    type="button"
                    onClick={() => setDeleting(row)}
                    disabled={deleteBusy || returnBusy}
                    className="rounded-md border border-status-danger-border px-2 py-1 text-xs text-status-danger-text hover:bg-status-danger-bg/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    删除
                  </button>
                )}
              </div>
            ),
          },
        ]}
        rows={items}
        rowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={refresh}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
      />

      <ConfirmActionDialog
        open={deleting !== null}
        title={"删除入库单「" + (deleting?.code ?? "") + "」？"}
        description="仅未过账（草稿/已取消）入库单可删除；已过账（POSTED）已形成库存/GRIR 事实，禁止删除。"
        confirmLabel="确认删除"
        tone="danger"
        busy={deleteBusy}
        onConfirm={runDelete}
        onCancel={() => setDeleting(null)}
      />

      {/* ── 一键退货对话框（列表操作区；全退/部分退；用户指令 2026-08-21） ── */}
      {returnTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setReturnTarget(null)}
        >
          <div
            className="border-border bg-surface shadow-elevation-lg w-full max-w-xl rounded-lg border p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-ink-primary text-base font-semibold">退货并反收货（{returnTarget.code}）</h2>
            <p className="text-ink-secondary mt-2 text-xs">
              错误入库反操作：按行退货（默认全退，可改为部分退）→ 完成退货（GRIR 冲销 + PO 履约 reopen）→ 反收货回滚。
            </p>
            {returnError && (
              <div className="border-status-danger-border bg-status-danger-bg text-status-danger-text mt-3 rounded-md border p-2 text-sm">
                {returnError}
              </div>
            )}
            <div className="mt-4 space-y-2 text-sm">
              <label className="text-ink-secondary block text-xs">处置方式</label>
              <select
                value={returnDisposition}
                onChange={(e) => setReturnDisposition(e.target.value)}
                className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
              >
                <option value="REPLACE_REQUIRED">补货（供应商仍欠货，重开 PO 待交）</option>
                <option value="CREDIT_ONLY">仅退款（不重开待交）</option>
              </select>
              <div className="mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
                {returnLines.length === 0 && !returnError && (
                  <p className="text-ink-muted text-xs">加载中…</p>
                )}
                {returnLines.map((l, i) => (
                  <div key={l.id} className="border-border flex items-center gap-3 rounded-md border p-2">
                    <span className="text-ink-secondary flex-1 truncate text-xs">{l.label}</span>
                    <label className="text-ink-secondary text-xs">退货数量</label>
                    <input
                      type="number"
                      min="0"
                      max={l.maxQty}
                      step="any"
                      value={l.qty}
                      onChange={(e) =>
                        setReturnLines((prev) => prev.map((p, idx) => (idx === i ? { ...p, qty: e.target.value } : p)))
                      }
                      className="focus:border-brand-500 w-24 rounded-md border border-border px-2 py-1 focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReturnTarget(null)}
                disabled={returnBusy}
                className="border-border text-ink-secondary rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleReturnSubmit}
                disabled={returnBusy}
                className="rounded-md border border-status-danger-border bg-status-danger-bg/10 px-3 py-1.5 text-sm font-medium text-status-danger-text hover:bg-status-danger-bg/20 disabled:cursor-not-allowed disabled:opacity-50"
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
      <WarehouseReceiptList />
    </PermissionGuard>
  );
}