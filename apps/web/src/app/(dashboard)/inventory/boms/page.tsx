"use client";

/**
 * BOM — 物料配方列表页（P-4 Item Sourcing，ADR-0049）
 *
 * 成品物料组合固定配方（系数 + 损耗率；吨→米/件/个在系数表达）。
 * AppPage → EntityListWorkspace → useListQuery；PermissionGuard 对齐 bom:view。
 */
import { useState } from "react";
import Link from "next/link";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { useSession } from "@/lib/session-context";
import { AppPage, EntityListWorkspace, StatusBadge, ConfirmActionDialog } from "@/components/workspace";
import { SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiClientError } from "@/lib/api-client";

interface BomRow {
  id: string;
  bomNo: string;
  bomVersion: number;
  status: string;
  isDefault: boolean;
  remark?: string | null;
  finishedItem?: { id: string; code: string | null; name: string | null; model: string | null } | null;
  _count?: { lines: number };
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  ACTIVE: "生效",
  ARCHIVED: "归档",
};

const STATUS_TONE_MAP: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral",
  ACTIVE: "success",
  ARCHIVED: "warning",
};

function BomList() {
  const toast = useToast();
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];
  const canCreate = hasPermission(roles, actionPermission("bom", "create"));
  const canEdit = hasPermission(roles, actionPermission("bom", "edit"));
  const canDelete = hasPermission(roles, actionPermission("bom", "delete"));
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ status?: string }>({});
  const [deleting, setDeleting] = useState<BomRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<BomRow>("/api/boms", filters);

  const applyFilter = () => {
    setFilters(statusInput ? { status: statusInput } : {});
    setPage(1);
  };
  const resetFilter = () => {
    setStatusInput("");
    setFilters({});
    setPage(1);
  };

  const runDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await apiFetch("/api/boms/" + deleting.id, { method: "DELETE" });
      toast.success("配方已删除");
      setDeleting(null);
      refresh();
    } catch (err) {
      const e = err instanceof ApiClientError ? err : new ApiClientError(0, "删除失败", "NETWORK_ERROR");
      toast.error("删除失败", e.message);
      setDeleting(null);
      refresh();
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <AppPage>
      <EntityListWorkspace<BomRow>
        title="物料配方"
        description="成品物料组合固定配方（系数 + 损耗率；吨→米/件/个在系数表达）；1 成品 = N 行原料，多版本，ACTIVE 唯一"
        emptyMessage="暂无配方——点击「+ 新建配方」为成品维护物料组合配方"
        headerActions={
          canCreate ? (
            <Link href="/inventory/boms/new" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              + 新建配方
            </Link>
          ) : undefined
        }
        filters={
          <>
            <select value={statusInput} onChange={(e) => setStatusInput(e.target.value)} className={SELECT_CLASS}>
              <option value="">全部状态</option>
              <option value="DRAFT">草稿</option>
              <option value="ACTIVE">生效</option>
              <option value="ARCHIVED">归档</option>
            </select>
          </>
        }
        toolbarActions={
          <>
            <button type="button" onClick={applyFilter} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              查询
            </button>
            <button type="button" onClick={resetFilter} className="rounded-md border border-border px-4 py-2 text-sm text-ink-primary hover:bg-canvas">
              重置
            </button>
          </>
        }
        columns={[
          {
            key: "bomNo",
            header: "配方编码",
            render: (row) => (
              <Link href={`/inventory/boms/${row.id}`} className="font-medium text-brand-600 hover:underline">
                {row.bomNo}
              </Link>
            ),
          },
          {
            key: "finishedItem",
            header: "成品",
            render: (row) =>
              row.finishedItem ? `${row.finishedItem.code ?? ""} ${row.finishedItem.name ?? ""}`.trim() : "—",
          },
          { key: "bomVersion", header: "版本", render: (row) => `v${row.bomVersion}` },
          {
            key: "status",
            header: "状态",
            render: (row) => (
              <StatusBadge status={row.status} label={STATUS_LABELS[row.status] ?? row.status} toneMap={STATUS_TONE_MAP} />
            ),
          },
          { key: "lines", header: "原料行数", render: (row) => String(row._count?.lines ?? 0) },
          { key: "isDefault", header: "默认", render: (row) => (row.isDefault ? "是" : "—") },
          {
            key: "actions",
            header: "操作",
            render: (row) => (
              <div className="flex items-center gap-2">
                <Link href={`/inventory/boms/${row.id}`} className="rounded-md border border-border px-2 py-1 text-xs text-ink-primary hover:bg-canvas">
                  详情
                </Link>
                {row.status === "DRAFT" && canEdit && (
                  <Link href={`/inventory/boms/${row.id}/edit`} className="rounded-md border border-border px-2 py-1 text-xs text-ink-primary hover:bg-canvas">
                    编辑
                  </Link>
                )}
                {row.status === "DRAFT" && canDelete && (
                  <button
                    type="button"
                    onClick={() => setDeleting(row)}
                    disabled={deleteBusy}
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
        title={"删除配方「" + (deleting?.bomNo ?? "") + "」？"}
        description="仅草稿状态的配方可删除；删除后列表不再展示。"
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
    <PermissionGuard permission={actionPermission("bom", "view")}>
      <BomList />
    </PermissionGuard>
  );
}
