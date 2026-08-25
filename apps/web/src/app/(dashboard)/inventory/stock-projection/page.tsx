"use client";

/**
 * Inventory Read Model — 库存余额投影列表页（Read Model Gate FINAL，CTO Directive 2026-08-12 §15/§16）
 *
 * 只读：余额唯一权威 = 后端 StockProjection SSOT；前端禁止 SUM InventoryMovement / 自拼余额（§14）。
 * 复用 F2-3 Workspace：AppPage → EntityListWorkspace + useListQuery + PermissionGuard。
 * 过滤：物料搜索 / 仓库（下拉，best-effort）/ 批次 / 序列号；location 过滤后端已支持，UI 下拉后续 Gate 加。
 */
import { useEffect, useState } from "react";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PERMISSIONS } from "@nilier-crm/shared";
import { AppPage, EntityListWorkspace } from "@/components/workspace";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";
import { apiFetch } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";

interface WarehouseOption {
  id: string;
  name: string | null;
}

interface StockProjectionRow {
  id: string;
  onHandQty: string;
  lastMovementAt: string | null;
  warehouse?: { id: string; name: string | null } | null;
  location?: { id: string; name: string | null } | null;
  item?: { id: string; code: string | null; name: string | null } | null;
  batchNo?: string | null;
  serialNo?: string | null;
}

function StockProjectionList() {
  const [itemInput, setItemInput] = useState("");
  const [warehouseInput, setWarehouseInput] = useState("");
  const [batchInput, setBatchInput] = useState("");
  const [serialInput, setSerialInput] = useState("");
  const [filters, setFilters] = useState<{
    item?: string;
    warehouseId?: string;
    batchNo?: string;
    serialNo?: string;
  }>({});
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);

  useEffect(() => {
    const c = new AbortController();
    apiFetch<WarehouseOption[]>("/api/warehouses?pageSize=100", { signal: c.signal })
      .then((b) => setWarehouses(b.data))
      .catch(() => setWarehouses([])); // best-effort：无 warehouse:view 权限时下拉为空，列表仍可用
    return () => c.abort();
  }, []);

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<StockProjectionRow>("/api/stock-projections", filters);

  const applyFilter = () => {
    const next: typeof filters = {};
    if (itemInput.trim()) next.item = itemInput.trim();
    if (warehouseInput) next.warehouseId = warehouseInput;
    if (batchInput.trim()) next.batchNo = batchInput.trim();
    if (serialInput.trim()) next.serialNo = serialInput.trim();
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setItemInput("");
    setWarehouseInput("");
    setBatchInput("");
    setSerialInput("");
    setFilters({});
    setPage(1);
  };

  return (
    <AppPage>
      <EntityListWorkspace<StockProjectionRow>
        title="库存余额投影"
        description="五维库存余额（物料/仓库/库位/批次/序列号）只读；余额全部来自后端 StockProjection SSOT，前端不自行计算。"
        filters={
          <>
            <input
              value={itemInput}
              onChange={(e) => setItemInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按物料编码/名称搜索"
              className={"w-44 " + SELECT_CLASS}
            />
            <select
              value={warehouseInput}
              onChange={(e) => setWarehouseInput(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">全部仓库</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name ?? w.id}
                </option>
              ))}
            </select>
            <input
              value={batchInput}
              onChange={(e) => setBatchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="批次"
              className={"w-32 " + SELECT_CLASS}
            />
            <input
              value={serialInput}
              onChange={(e) => setSerialInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="序列号"
              className={"w-32 " + SELECT_CLASS}
            />
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
            key: "item",
            header: "物料",
            render: (r) => (r.item ? `${r.item.code ?? ""} ${r.item.name ?? ""}`.trim() : "—"),
          },
          { key: "warehouse", header: "仓库", render: (r) => r.warehouse?.name ?? "—" },
          { key: "location", header: "库位", render: (r) => r.location?.name ?? "—" },
          { key: "batchNo", header: "批次", render: (r) => r.batchNo ?? "—" },
          { key: "serialNo", header: "序列号", render: (r) => r.serialNo ?? "—" },
          { key: "onHandQty", header: "在库数量", align: "right", render: (r) => r.onHandQty },
          { key: "lastMovementAt", header: "最后变动", render: (r) => formatDate(r.lastMovementAt) },
        ]}
        rows={items}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        onRetry={refresh}
        emptyMessage="暂无库存余额记录"
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
    <PermissionGuard permission={PERMISSIONS.STOCK_PROJECTION_READ}>
      <StockProjectionList />
    </PermissionGuard>
  );
}