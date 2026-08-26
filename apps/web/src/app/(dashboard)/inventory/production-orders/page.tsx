"use client";

/**
 * Production Orders — 生产/外协工单列表页（P-4 Item Sourcing，ADR-0049 + UI-09 FE2.0 统一）
 *
 * AppPage → EntityListWorkspace → useListQuery；PermissionGuard 对齐 production-order:view。
 * UI-09：按钮收敛至 BUTTON_PRIMARY_CLASS / BUTTON_SECONDARY_CLASS；
 * 行操作移入 rowActions（hover 浮现）；数字列右对齐 tabular-nums。
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { useSession } from "@/lib/session-context";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery, readUrlFilterParams } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";

interface OrderRow {
  id: string;
  orderNo: string;
  productionType: string;
  plannedQty: string;
  status: string;
  batchNo?: string | null;
  productionDate?: string | null;
  finishedItem?: { id: string; code: string | null; name: string | null; model: string | null } | null;
  supplier?: { id: string; code: string | null; name: string | null } | null;
  _count?: { lines: number };
}

const TYPE_LABELS: Record<string, string> = {
  SELF_MANUFACTURE: "自产",
  OEM_OUTSOURCING: "OEM 外协",
};
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "已提交",
  POSTED: "已过账",
  CANCELLED: "已取消",
};
const STATUS_TONE_MAP: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  POSTED: "success",
  CANCELLED: "danger",
};

function ProductionOrderList() {
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];
  const canCreate = hasPermission(roles, actionPermission("production-order", "create"));
  const [statusInput, setStatusInput] = useState("");
  const [typeInput, setTypeInput] = useState("");
  const [filters, setFilters] = useState<{ status?: string; productionType?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, setPageSize, refresh } =
    useListQuery<OrderRow>("/api/production-orders", filters, 20, { syncUrl: true });
  // URL 筛选恢复（hydration 后一次性应用；刷新/分享后筛选不丢失）
  const urlRestored = useRef(false);
  useEffect(() => {
    if (urlRestored.current) return;
    urlRestored.current = true;
    const u = readUrlFilterParams(["status", "productionType"]);
    setStatusInput(u.status ?? "");
    setTypeInput(u.productionType ?? "");
    setFilters(() => {
      const n: { status?: string; productionType?: string } = {};
      if (u.status) n.status = u.status;
      if (u.productionType) n.productionType = u.productionType;
      return n;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilter = () => {
    const next: { status?: string; productionType?: string } = {};
    if (statusInput) next.status = statusInput;
    if (typeInput) next.productionType = typeInput;
    setFilters(next);
    setPage(1);
  };
  const resetFilter = () => {
    setStatusInput("");
    setTypeInput("");
    setFilters({});
    setPage(1);
  };

  return (
    <AppPage>
      <EntityListWorkspace<OrderRow>
        title="生产/外协工单"
        description="自产或 OEM 外协（我方供料 + 加工费）：领料出库 → 成品入库（POSTED 同事务，成本 = Σ原料成本 + 加工费）"
        emptyMessage="暂无工单——点击「+ 新建工单」创建第一张生产/外协工单"
        headerActions={
          canCreate ? (
            <Link href="/inventory/production-orders/new" className={BUTTON_PRIMARY_CLASS}>
              + 新建工单
            </Link>
          ) : undefined
        }
        filters={
          <>
            <select value={typeInput} onChange={(e) => setTypeInput(e.target.value)} className={SELECT_CLASS}>
              <option value="">全部类型</option>
              <option value="SELF_MANUFACTURE">自产</option>
              <option value="OEM_OUTSOURCING">OEM 外协</option>
            </select>
            <select value={statusInput} onChange={(e) => setStatusInput(e.target.value)} className={SELECT_CLASS}>
              <option value="">全部状态</option>
              <option value="DRAFT">草稿</option>
              <option value="SUBMITTED">已提交</option>
              <option value="POSTED">已过账</option>
              <option value="CANCELLED">已取消</option>
            </select>
          </>
        }
        toolbarActions={
          <>
            <button type="button" onClick={applyFilter} className={BUTTON_PRIMARY_CLASS}>
              查询
            </button>
            <button type="button" onClick={resetFilter} className={BUTTON_SECONDARY_CLASS}>
              重置
            </button>
          </>
        }
        columns={[
          {
            key: "orderNo",
            header: "工单号",
            render: (row) => (
              <Link href={`/inventory/production-orders/${row.id}`} className="font-medium text-brand-600 hover:underline">
                {row.orderNo}
              </Link>
            ),
          },
          { key: "productionType", header: "类型", render: (row) => TYPE_LABELS[row.productionType] ?? row.productionType },
          {
            key: "finishedItem",
            header: "成品",
            render: (row) => (row.finishedItem ? `${row.finishedItem.code ?? ""} ${row.finishedItem.name ?? ""}`.trim() : "—"),
          },
          { key: "plannedQty", header: "产出数量", align: "right", render: (row) => row.plannedQty },
          {
            key: "status",
            header: "状态",
            render: (row) => (
              <StatusBadge status={row.status} label={STATUS_LABELS[row.status] ?? row.status} toneMap={STATUS_TONE_MAP} />
            ),
          },
          { key: "supplier", header: "外协厂", render: (row) => row.supplier?.name ?? "—" },
          { key: "batchNo", header: "批次", render: (row) => row.batchNo ?? "—" },
          { key: "productionDate", header: "完工日期", render: (row) => formatDate(row.productionDate) },
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
          filters.status
            ? {
                key: "status",
                label: `状态：${STATUS_LABELS[filters.status] ?? filters.status}`,
                onClear: () => {
                  setStatusInput("");
                  setFilters((prev) => {
                    const n = { ...prev };
                    delete n.status;
                    return n;
                  });
                },
              }
            : null,
          filters.productionType
            ? {
                key: "productionType",
                label: `类型：${TYPE_LABELS[filters.productionType] ?? filters.productionType}`,
                onClear: () => {
                  setTypeInput("");
                  setFilters((prev) => {
                    const n = { ...prev };
                    delete n.productionType;
                    return n;
                  });
                },
              }
            : null,
        ].filter((c): c is NonNullable<typeof c> => c !== null)}
        rowActions={(row) => (
          <Link
            href={`/inventory/production-orders/${row.id}`}
            className="border-border text-ink-secondary rounded-md border px-2 py-1 text-xs hover:bg-canvas"
          >
            详情
          </Link>
        )}
      />
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("production-order", "view")}>
      <ProductionOrderList />
    </PermissionGuard>
  );
}
