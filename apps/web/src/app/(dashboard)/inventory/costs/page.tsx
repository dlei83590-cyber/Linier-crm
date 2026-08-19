"use client";

/** 库存成本（移动加权平均）— 只读列表页（D9 HOLD 解除，ADR-0038；成本敏感仅 SUPER_ADMIN/ADMIN） */
import { useState } from "react";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityListWorkspace } from "@/components/workspace";
import { useListQuery } from "@/lib/use-list-query";
import { formatMoney } from "@/lib/format";

interface CostRow {
  id: string;
  itemId: string;
  itemCode: string | null;
  itemName: string | null;
  itemModel: string | null;
  onHandQty: string;
  totalCost: string;
  avgUnitCost: string;
  updatedAt: string;
}

function InventoryCostList() {
  const [codeInput, setCodeInput] = useState("");
  const [filters, setFilters] = useState<{ itemCode?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<CostRow>("/api/inventory-costs", filters);

  const applyFilter = () => {
    const next: { itemCode?: string } = {};
    if (codeInput.trim()) next.itemCode = codeInput.trim();
    setFilters(next);
    setPage(1);
  };
  const resetFilter = () => { setCodeInput(""); setFilters({}); setPage(1); };

  return (
    <AppPage>
      <EntityListWorkspace<CostRow>
        title="库存成本（移动加权平均）"
        description="入库自动更新移动平均成本（未税采购成本口径）；成本敏感仅 SUPER_ADMIN/ADMIN 可查看"
        filters={
          <input value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="物料编码" className="rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none" />
        }
        toolbarActions={
          <>
            <button type="button" onClick={applyFilter} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">查询</button>
            <button type="button" onClick={resetFilter} className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-slate-50">重置</button>
          </>
        }
        columns={[
          { key: "itemCode", header: "物料编码", render: (row) => row.itemCode ?? "—" },
          { key: "itemName", header: "物料名称", render: (row) => row.itemName ?? "—" },
          { key: "itemModel", header: "型号", render: (row) => row.itemModel ?? "—" },
          { key: "onHandQty", header: "在库数量", render: (row) => row.onHandQty },
          { key: "avgUnitCost", header: "平均成本", render: (row) => formatMoney(row.avgUnitCost, "CNY") },
          { key: "totalCost", header: "库存总成本", render: (row) => formatMoney(row.totalCost, "CNY") },
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
    <PermissionGuard permission={actionPermission("inventory-cost", "view")}>
      <InventoryCostList />
    </PermissionGuard>
  );
}
