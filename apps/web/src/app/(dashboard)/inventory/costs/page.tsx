"use client";

/** 库存成本（移动加权平均）— 只读列表页（D9 HOLD 解除，ADR-0038；成本敏感仅 SUPER_ADMIN/ADMIN） */
import { useEffect, useRef, useState } from "react";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityListWorkspace } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery, readUrlFilterParams } from "@/lib/use-list-query";
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

  const { items, total, page, pageSize, loading, error, setPage, setPageSize, refresh } =
    useListQuery<CostRow>("/api/inventory-costs", filters, 20, { syncUrl: true });
  // URL 筛选恢复（hydration 后一次性应用；刷新/分享后筛选不丢失）
  const urlRestored = useRef(false);
  useEffect(() => {
    if (urlRestored.current) return;
    urlRestored.current = true;
    const u = readUrlFilterParams(["itemCode"]);
    setCodeInput(u.itemCode ?? "");
    setFilters(() => {
      const n: { itemCode?: string } = {};
      if (u.itemCode) n.itemCode = u.itemCode;
      return n;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <input value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="物料编码" className={SELECT_CLASS} />
        }
        toolbarActions={
          <>
            <button type="button" onClick={applyFilter} className={BUTTON_PRIMARY_CLASS}>查询</button>
            <button type="button" onClick={resetFilter} className={BUTTON_SECONDARY_CLASS}>重置</button>
          </>
        }
        columns={[
          { key: "itemCode", header: "物料编码", render: (row) => row.itemCode ?? "—" },
          { key: "itemName", header: "物料名称", render: (row) => row.itemName ?? "—" },
          { key: "itemModel", header: "型号", render: (row) => row.itemModel ?? "—" },
          { key: "onHandQty", header: "在库数量", align: "right", render: (row) => row.onHandQty },
          { key: "avgUnitCost", header: "平均成本", align: "right", render: (row) => formatMoney(row.avgUnitCost, "CNY") },
          { key: "totalCost", header: "库存总成本", align: "right", render: (row) => formatMoney(row.totalCost, "CNY") },
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
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        activeFilters={[
          filters.itemCode
            ? {
                key: "itemCode",
                label: `物料编码：${filters.itemCode}`,
                onClear: () => {
                  setCodeInput("");
                  setFilters((prev) => {
                    const n = { ...prev };
                    delete n.itemCode;
                    return n;
                  });
                },
              }
            : null,
        ].filter((c): c is NonNullable<typeof c> => c !== null)}
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