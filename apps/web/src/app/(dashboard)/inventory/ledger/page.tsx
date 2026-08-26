"use client";

/**
 * Inventory Read Model — 库存流水列表页（Read Model Gate FINAL，CTO Directive 2026-08-12 §15/§16）
 *
 * 只读 Trace / Audit Query：不可变账本 InventoryMovement 追溯；**不是余额 API**——
 * 前端禁止 SUM quantity 充当权威余额（§14），余额以 Stock Projection 页为准。
 * 复用 F2-3 Workspace：AppPage → EntityListWorkspace + useListQuery + PermissionGuard。
 * 行链接 → /inventory/ledger/[id] 详情。
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PERMISSIONS } from "@nilier-crm/shared";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { useListQuery, readUrlFilterParams } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";
import { apiFetch } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";

interface WarehouseOption {
  id: string;
  name: string | null;
}

interface MovementRow {
  id: string;
  movementNo: string;
  direction: string;
  movementType: string;
  sourceType: string;
  quantity: string;
  referenceNo?: string | null;
  committedAt: string;
  warehouse?: { id: string; name: string | null } | null;
  location?: { id: string; name: string | null } | null;
  item?: { id: string; code: string | null; name: string | null } | null;
}

const MOVEMENT_TYPE_OPTIONS = [
  "INBOUND",
  "OUTBOUND",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "CONSUME",
  "PRODUCE",
  "ADJUSTMENT",
  "REVERSAL",
  "CORRECTION",
] as const;

const DIRECTION_OPTIONS = ["IN", "OUT"] as const;

const SOURCE_TYPE_OPTIONS = [
  "WAREHOUSE_RECEIPT_POSTED",
  "PURCHASE_RETURN_RETURNED",
  "TRANSFER",
  "ADJUSTMENT",
  "CONVERSION",
  "PRODUCTION",
  "SALES_DELIVERY",
  "REVERSAL",
  "CORRECTION",
] as const;

function MovementList() {
  const [itemInput, setItemInput] = useState("");
  const [warehouseInput, setWarehouseInput] = useState("");
  const [movementTypeInput, setMovementTypeInput] = useState("");
  const [directionInput, setDirectionInput] = useState("");
  const [sourceTypeInput, setSourceTypeInput] = useState("");
  const [dateFromInput, setDateFromInput] = useState("");
  const [dateToInput, setDateToInput] = useState("");
  const [filters, setFilters] = useState<{
    item?: string;
    warehouseId?: string;
    movementType?: string;
    direction?: string;
    sourceType?: string;
    dateFrom?: string;
    dateTo?: string;
  }>({});
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);

  useEffect(() => {
    const c = new AbortController();
    apiFetch<WarehouseOption[]>("/api/warehouses?pageSize=100", { signal: c.signal })
      .then((b) => setWarehouses(b.data))
      .catch(() => setWarehouses([])); // best-effort：无 warehouse:view 权限时下拉为空，列表仍可用
    return () => c.abort();
  }, []);

  const { items, total, page, pageSize, loading, error, setPage, setPageSize, refresh } =
    useListQuery<MovementRow>("/api/inventory-movements", filters, 20, { syncUrl: true });
  // URL 筛选恢复（hydration 后一次性应用；刷新/分享后筛选不丢失）
  const urlRestored = useRef(false);
  useEffect(() => {
    if (urlRestored.current) return;
    urlRestored.current = true;
    const u = readUrlFilterParams(["item", "warehouseId", "movementType", "direction", "sourceType", "dateFrom", "dateTo"]);
    setItemInput(u.item ?? "");
    setWarehouseInput(u.warehouseId ?? "");
    setMovementTypeInput(u.movementType ?? "");
    setDirectionInput(u.direction ?? "");
    setSourceTypeInput(u.sourceType ?? "");
    setDateFromInput((u.dateFrom ?? "").slice(0, 10));
    setDateToInput((u.dateTo ?? "").slice(0, 10));
    setFilters(() => {
      const n: { item?: string; warehouseId?: string; movementType?: string; direction?: string; sourceType?: string; dateFrom?: string; dateTo?: string } = {};
      if (u.item) n.item = u.item;
      if (u.warehouseId) n.warehouseId = u.warehouseId;
      if (u.movementType) n.movementType = u.movementType;
      if (u.direction) n.direction = u.direction;
      if (u.sourceType) n.sourceType = u.sourceType;
      if (u.dateFrom) n.dateFrom = u.dateFrom;
      if (u.dateTo) n.dateTo = u.dateTo;
      return n;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilter = () => {
    const next: typeof filters = {};
    if (itemInput.trim()) next.item = itemInput.trim();
    if (warehouseInput) next.warehouseId = warehouseInput;
    if (movementTypeInput) next.movementType = movementTypeInput;
    if (directionInput) next.direction = directionInput;
    if (sourceTypeInput) next.sourceType = sourceTypeInput;
    if (dateFromInput) next.dateFrom = `${dateFromInput}T00:00:00`;
    if (dateToInput) next.dateTo = `${dateToInput}T23:59:59`;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setItemInput("");
    setWarehouseInput("");
    setMovementTypeInput("");
    setDirectionInput("");
    setSourceTypeInput("");
    setDateFromInput("");
    setDateToInput("");
    setFilters({});
    setPage(1);
  };

  return (
    <AppPage>
      <EntityListWorkspace<MovementRow>
        title="库存流水"
        description="InventoryMovement 不可变账本只读追溯（库存数量唯一事实源 SSOT）；流水为 Trace/Audit 查询，非余额 API。"
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
            <select
              value={movementTypeInput}
              onChange={(e) => setMovementTypeInput(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">全部类型</option>
              {MOVEMENT_TYPE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={directionInput}
              onChange={(e) => setDirectionInput(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">全部方向</option>
              {DIRECTION_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={sourceTypeInput}
              onChange={(e) => setSourceTypeInput(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">全部来源</option>
              {SOURCE_TYPE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={dateFromInput}
              onChange={(e) => setDateFromInput(e.target.value)}
              className={SELECT_CLASS}
            />
            <span className="text-xs text-ink-muted">至</span>
            <input
              type="date"
              value={dateToInput}
              onChange={(e) => setDateToInput(e.target.value)}
              className={SELECT_CLASS}
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
            key: "movementNo",
            header: "流水号",
            render: (r) => (
              <Link href={`/inventory/ledger/${r.id}`} className="text-brand-600 hover:underline">
                {r.movementNo}
              </Link>
            ),
          },
          { key: "committedAt", header: "入账时间", render: (r) => formatDate(r.committedAt) },
          {
            key: "direction",
            header: "方向",
            render: (r) =>
              r.direction === "IN" ? (
                <StatusBadge status={r.direction} tone="success" />
              ) : (
                <StatusBadge status={r.direction} tone="danger" />
              ),
          },
          { key: "movementType", header: "类型", render: (r) => r.movementType },
          { key: "sourceType", header: "来源类型", render: (r) => r.sourceType },
          {
            key: "item",
            header: "物料",
            render: (r) => (r.item ? `${r.item.code ?? ""} ${r.item.name ?? ""}`.trim() : "—"),
          },
          {
            key: "warehouse",
            header: "仓库/库位",
            render: (r) => [r.warehouse?.name, r.location?.name].filter(Boolean).join(" / ") || "—",
          },
          { key: "quantity", header: "数量", align: "right", render: (r) => r.quantity },
          { key: "referenceNo", header: "业务单号", render: (r) => r.referenceNo ?? "—" },
        ]}
        rows={items}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        onRetry={refresh}
        emptyMessage="暂无库存流水记录"
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        activeFilters={[
          filters.item
            ? {
                key: "item",
                label: `物料：${filters.item}`,
                onClear: () => {
                  setItemInput("");
                  setFilters((prev) => {
                    const n = { ...prev };
                    delete n.item;
                    return n;
                  });
                },
              }
            : null,
          filters.warehouseId
            ? {
                key: "warehouseId",
                label: `仓库：${warehouses.find((w) => w.id === filters.warehouseId)?.name ?? filters.warehouseId}`,
                onClear: () => {
                  setWarehouseInput("");
                  setFilters((prev) => {
                    const n = { ...prev };
                    delete n.warehouseId;
                    return n;
                  });
                },
              }
            : null,
          filters.movementType
            ? {
                key: "movementType",
                label: `类型：${filters.movementType}`,
                onClear: () => {
                  setMovementTypeInput("");
                  setFilters((prev) => {
                    const n = { ...prev };
                    delete n.movementType;
                    return n;
                  });
                },
              }
            : null,
          filters.direction
            ? {
                key: "direction",
                label: `方向：${filters.direction}`,
                onClear: () => {
                  setDirectionInput("");
                  setFilters((prev) => {
                    const n = { ...prev };
                    delete n.direction;
                    return n;
                  });
                },
              }
            : null,
          filters.sourceType
            ? {
                key: "sourceType",
                label: `来源：${filters.sourceType}`,
                onClear: () => {
                  setSourceTypeInput("");
                  setFilters((prev) => {
                    const n = { ...prev };
                    delete n.sourceType;
                    return n;
                  });
                },
              }
            : null,
          filters.dateFrom || filters.dateTo
            ? {
                key: "date",
                label: `日期：${filters.dateFrom?.slice(0, 10) ?? "…"} ~ ${filters.dateTo?.slice(0, 10) ?? "…"}`,
                onClear: () => {
                  setDateFromInput("");
                  setDateToInput("");
                  setFilters((prev) => {
                    const n = { ...prev };
                    delete n.dateFrom;
                    delete n.dateTo;
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
    <PermissionGuard permission={PERMISSIONS.INVENTORY_MOVEMENT_READ}>
      <MovementList />
    </PermissionGuard>
  );
}