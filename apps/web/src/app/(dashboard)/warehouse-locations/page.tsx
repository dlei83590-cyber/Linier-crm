"use client";

/**
 * Warehouse Locations — 库位列表页（主数据 CRUD：新建/编辑/删除行操作）
 * 父上下文：支持 ?warehouseId= 参数（从仓库行「查看库位」进入），同时保留独立搜索入口。
 * 删除遵循「有应用不可删除（可编辑）」：被库存流水/单据/盘点/调拨/调整/转换引用 → 后端 409。
 */
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { hasPermission, actionPermission, PERMISSIONS, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, ConfirmActionDialog } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";

interface LocationRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  warehouse?: { id: string; code: string | null; name: string | null } | null;
  createdAt: string;
}

function LocationListInner() {
  const router = useRouter();
  const toast = useToast();
  const searchParams = useSearchParams();
  const initialWarehouseId = searchParams.get("warehouseId") ?? "";
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];
  const canCreate = hasPermission(roles, actionPermission("warehouse-location", "create"));
  const canEdit = hasPermission(roles, actionPermission("warehouse-location", "edit"));
  const canDelete = hasPermission(roles, actionPermission("warehouse-location", "delete"));
  const [deleting, setDeleting] = useState<LocationRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [codeInput, setCodeInput] = useState("");
  const [activeInput, setActiveInput] = useState("");
  const [filters, setFilters] = useState<{ warehouseId?: string; code?: string; isActive?: string }>(
    initialWarehouseId ? { warehouseId: initialWarehouseId } : {},
  );

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<LocationRow>("/api/warehouse-locations", filters);

  const applyFilter = () => {
    const next: { warehouseId?: string; code?: string; isActive?: string } = {
      warehouseId: initialWarehouseId || undefined,
    };
    if (codeInput.trim()) next.code = codeInput.trim();
    if (activeInput) next.isActive = activeInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setCodeInput("");
    setActiveInput("");
    setFilters(initialWarehouseId ? { warehouseId: initialWarehouseId } : {});
    setPage(1);
  };

  const runDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await apiFetch("/api/warehouse-locations/" + deleting.id, { method: "DELETE" });
      toast.success("库位已删除");
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
      <EntityListWorkspace<LocationRow>
        title="库位"
        description={
          initialWarehouseId
            ? "库位列表（已按所属仓库过滤，来自仓库详情入口）——支持新建/编辑/删除"
            : "库位主数据（按仓库划分的存储位置）——支持新建/编辑/删除"
        }
        emptyMessage="暂无库位——点击「+ 新建库位」创建第一个库位"
        headerActions={
          canCreate ? (
            <Link
              href={initialWarehouseId ? "/warehouse-locations/new?warehouseId=" + initialWarehouseId : "/warehouse-locations/new"}
              className={BUTTON_PRIMARY_CLASS}
            >
              + 新建库位
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
              placeholder="按编码搜索"
              className={"w-40 " + SELECT_CLASS}
            />
            <select
              value={activeInput}
              onChange={(e) => setActiveInput(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">全部状态</option>
              <option value="true">启用</option>
              <option value="false">停用</option>
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
            header: "库位编码",
            render: (row) => (
              <Link href={"/warehouse-locations/" + row.id + "/edit"} className="font-medium text-brand-600 hover:underline">
                {row.code}
              </Link>
            ),
          },
          { key: "name", header: "名称" },
          {
            key: "warehouse",
            header: "所属仓库",
            render: (row) => row.warehouse?.name ?? row.warehouse?.code ?? "—",
          },
          {
            key: "isActive",
            header: "启用",
            render: (row) => (row.isActive ? "是" : "否"),
          },
          {
            key: "createdAt",
            header: "创建时间",
            render: (row) => formatDate(row.createdAt),
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
        rowActions={(row) => (
          <div className="flex justify-end gap-1">
            {canEdit && (
              <button type="button" onClick={() => router.push("/warehouse-locations/" + row.id + "/edit")} className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-slate-100">
                编辑
              </button>
            )}
            {canDelete && (
              <button type="button" onClick={() => setDeleting(row)} className="rounded-md border border-status-danger-border px-2 py-1 text-xs text-status-danger-text transition-colors hover:bg-red-50">
                删除
              </button>
            )}
          </div>
        )}
      />
      <ConfirmActionDialog
        open={deleting !== null}
        title={"删除库位「" + (deleting?.name ?? "") + "」？"}
        description="库位已被库存流水/单据/盘点/调拨/调整/转换引用后不可删除（可编辑）；无引用将软删除并停用。"
        confirmLabel="删除"
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
    <PermissionGuard permission={PERMISSIONS.WAREHOUSE_LOCATION_READ}>
      <Suspense fallback={null}>
        <LocationListInner />
      </Suspense>
    </PermissionGuard>
  );
}
