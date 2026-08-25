"use client";

/**
 * Production Orders — 生产/外协工单列表页（P-4 Item Sourcing，ADR-0049）
 *
 * AppPage → EntityListWorkspace → useListQuery；PermissionGuard 对齐 production-order:view。
 */
import { useState } from "react";
import Link from "next/link";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { useSession } from "@/lib/session-context";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
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

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<OrderRow>("/api/production-orders", filters);

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
            <Link href="/inventory/production-orders/new" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
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
          { key: "plannedQty", header: "产出数量", render: (row) => row.plannedQty },
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
          {
            key: "actions",
            header: "操作",
            render: (row) => (
              <Link href={`/inventory/production-orders/${row.id}`} className="rounded-md border border-border px-2 py-1 text-xs text-ink-primary hover:bg-canvas">
                详情
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
    <PermissionGuard permission={actionPermission("production-order", "view")}>
      <ProductionOrderList />
    </PermissionGuard>
  );
}
