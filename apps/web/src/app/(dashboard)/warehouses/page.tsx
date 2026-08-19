"use client";

/**
 * Warehouses — 仓库列表页（F2-2 Master Data Workspaces）
 *
 * 依据 Contract Card（warehouses.md）：backend 仅 GET list FINAL → 本 Wave 实现 List。
 * 关联体验：每行提供「查看库位」入口 → /warehouse-locations?warehouseId={id}
 * （warehouse-locations GET 支持 warehouseId 筛选，不新增后端 API）。
 */
import { useState } from "react";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PERMISSIONS } from "@nilier-crm/shared";
import { AppPage, EntityListWorkspace } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";

interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  type: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: string;
}

function WarehouseList() {
  const [codeInput, setCodeInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [typeInput, setTypeInput] = useState("");
  const [activeInput, setActiveInput] = useState("");
  const [filters, setFilters] = useState<{
    code?: string;
    name?: string;
    type?: string;
    isActive?: string;
  }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<WarehouseRow>("/api/warehouses", filters);

  const applyFilter = () => {
    const next: { code?: string; name?: string; type?: string; isActive?: string } = {};
    if (codeInput.trim()) next.code = codeInput.trim();
    if (nameInput.trim()) next.name = nameInput.trim();
    if (typeInput.trim()) next.type = typeInput.trim();
    if (activeInput) next.isActive = activeInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setCodeInput("");
    setNameInput("");
    setTypeInput("");
    setActiveInput("");
    setFilters({});
    setPage(1);
  };

  return (
    <AppPage>
      <EntityListWorkspace<WarehouseRow>
        title="仓库"
        description="仓库主数据（只读：后端当前仅开放列表契约；库位从仓库行进入）"
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
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按名称搜索"
              className={"w-40 " + SELECT_CLASS}
            />
            <input
              value={typeInput}
              onChange={(e) => setTypeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按类型搜索"
              className={"w-32 " + SELECT_CLASS}
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
          { key: "code", header: "编码" },
          { key: "name", header: "名称" },
          { key: "type", header: "类型", render: (row) => row.type ?? "—" },
          { key: "address", header: "地址", render: (row) => row.address ?? "—" },
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
          {
            key: "locations",
            header: "库位",
            render: (row) => (
              <Link
                href={`/warehouse-locations?warehouseId=${row.id}`}
                className="text-sm font-medium text-brand-600 hover:underline"
              >
                查看库位 →
              </Link>
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
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.WAREHOUSE_READ}>
      <WarehouseList />
    </PermissionGuard>
  );
}