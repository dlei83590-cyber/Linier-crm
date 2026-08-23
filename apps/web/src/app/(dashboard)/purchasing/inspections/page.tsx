"use client";

/**
 * Inspections — 质检记录列表页（F2-3 Batch C1 Consolidation，CTO #11888）
 *
 * 由旧式自绘 table/filter 迁移至统一 Workspace：
 * AppPage → EntityListWorkspace → StatusBadge / ErrorPanel / common toolbar。
 * 保留「+ 新建质检」入口（如有）；不改 backend / 状态机 / action。
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

interface InspectionRow {
  id: string;
  inspectionMode: string;
  result: string;
  qualifiedQty: string;
  rejectedQty: string;
  inspectedAt?: string | null;
  inspectedBy?: { name: string | null } | null;
  purchaseReceiptLine?: {
    lineNo: number;
    purchaseReceipt?: { code: string | null } | null;
    item?: { code: string | null; name: string | null } | null;
    uom?: { symbol: string | null } | null;
  } | null;
}

const MODE_OPTIONS = ["SKIP", "SPOT", "FULL"] as const;

/** 质检结果中文业务名（Business UX Rationalization：枚举展示中文，不展示数据库枚举值；key 保留真实 enum） */
const RESULT_LABELS: Record<string, string> = {
  QUALIFIED: "合格",
  PARTIAL: "部分合格",
  REJECTED: "拒收",
  PENDING: "待检",
};

function InspectionList() {
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("inspection", "create"));
  const canDelete = hasPermission(state.user?.roles as RoleCode[], actionPermission("inspection", "delete"));
  const toast = useToast();
  const [deleting, setDeleting] = useState<InspectionRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [modeInput, setModeInput] = useState("");
  const [resultInput, setResultInput] = useState("");
  const [filters, setFilters] = useState<{ inspectionMode?: string; result?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<InspectionRow>("/api/inspections", filters);

  const applyFilter = () => {
    const next: { inspectionMode?: string; result?: string } = {};
    if (modeInput) next.inspectionMode = modeInput;
    if (resultInput) next.result = resultInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setModeInput("");
    setResultInput("");
    setFilters({});
    setPage(1);
  };

  const runDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await apiFetch("/api/inspections/" + deleting.id, { method: "DELETE" });
      toast.success("质检记录已删除（无下链引用）");
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
      <EntityListWorkspace<InspectionRow>
        title="质检记录"
        description="质检记录工作台"
        headerActions={
          canCreate ? (
            <Link
              href="/purchasing/inspections/new"
              className={BUTTON_PRIMARY_CLASS}
            >
              + 新建质检
            </Link>
          ) : undefined
        }
        filters={
          <>
            <select
              value={modeInput}
              onChange={(e) => setModeInput(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">全部模式</option>
              {MODE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <select
              value={resultInput}
              onChange={(e) => setResultInput(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">全部结果</option>
              <option value="QUALIFIED">合格</option>
              <option value="PARTIAL">部分合格</option>
              <option value="REJECTED">拒收</option>
              <option value="PENDING">待检</option>
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
            key: "receipt",
            header: "收货单",
            render: (row) => (
              <Link
                href={`/purchasing/inspections/${row.id}`}
                className="font-medium text-brand-600 hover:underline"
              >
                {row.purchaseReceiptLine?.purchaseReceipt?.code ?? "—"}
              </Link>
            ),
          },
          {
            key: "lineNo",
            header: "行号",
            render: (row) => String(row.purchaseReceiptLine?.lineNo ?? "—"),
          },
          {
            key: "item",
            header: "物料",
            render: (row) =>
              row.purchaseReceiptLine?.item
                ? `${row.purchaseReceiptLine.item.code ?? ""} ${row.purchaseReceiptLine.item.name ?? ""}`.trim()
                : "—",
          },
          { key: "inspectionMode", header: "质检模式", render: (row) => row.inspectionMode },
          {
            key: "result",
            header: "结果",
            render: (row) => (
              <StatusBadge status={row.result} label={RESULT_LABELS[row.result] ?? row.result} />
            ),
          },
          { key: "qualifiedQty", header: "合格数量", render: (row) => row.qualifiedQty },
          { key: "rejectedQty", header: "拒收数量", render: (row) => row.rejectedQty },
          {
            key: "inspectedBy",
            header: "质检人",
            render: (row) => row.inspectedBy?.name ?? "—",
          },
          {
            key: "inspectedAt",
            header: "质检时间",
            render: (row) => formatDate(row.inspectedAt),
          },
          {
            key: "actions",
            header: "操作",
            render: (row) =>
              canDelete ? (
                <button
                  type="button"
                  onClick={() => setDeleting(row)}
                  disabled={deleteBusy}
                  className="rounded-md border border-status-danger-border px-2 py-1 text-xs text-status-danger-text hover:bg-status-danger-bg/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  删除
                </button>
              ) : null,
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
        title={"删除质检记录？"}
        description="删除质检（无入库/退货下链时）：PENDING 取消检验；已完成回退质检结论。有入库/退货引用时后端拒绝。"
        confirmLabel="确认删除"
        tone="danger"
        busy={deleteBusy}
        onConfirm={runDelete}
        onCancel={() => setDeleting(null)}
      />
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.INSPECTION_READ}>
      <InspectionList />
    </PermissionGuard>
  );
}