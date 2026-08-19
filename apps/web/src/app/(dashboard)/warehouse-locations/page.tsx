"use client";

/**
 * Warehouse Locations — 库位列表页（F2-2 Master Data Workspaces）
 *
 * 依据 Contract Card（warehouse-locations.md）：backend 仅 GET list FINAL → 本 Wave 实现 List。
 * 父上下文：支持 ?warehouseId= 参数（从仓库行「查看库位」进入），
 * 同时保留独立搜索入口；warehouseId 筛选为已核验的 backend 参数。
 */
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PERMISSIONS } from "@nilier-crm/shared";
import { AppPage, EntityListWorkspace } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
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
  const searchParams = useSearchParams();
  const initialWarehouseId = searchParams.get("warehouseId") ?? "";

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

  return (
    <AppPage>
      <EntityListWorkspace<LocationRow>
        title="库位"
        description={
          initialWarehouseId
            ? "库位列表（已按所属仓库过滤，来自仓库详情入口）"
            : "库位主数据（只读：后端当前仅开放列表契约）"
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
              className="w-40 rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            />
            <select
              value={activeInput}
              onChange={(e) => setActiveInput(e.target.value)}
              className="rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
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
          { key: "code", header: "库位编码" },
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