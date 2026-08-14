"use client";

/**
 * Inventory Adjustments — 库存调整列表页（F2-3 Batch C2 Consolidation，CTO #11888）
 *
 * 由旧式自绘 table/filter 迁移至统一 Workspace：
 * AppPage → EntityListWorkspace → StatusBadge / ErrorPanel / common toolbar。
 * 不改 backend / 状态机 / action；useListQuery + filters 原样保留。
 */
import { useState } from "react";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PERMISSIONS } from "@nilier-crm/shared";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";

interface AdjustmentRow {
  id: string;
  adjustmentNo: string;
  status: string;
  reasonCode: string;
  createdAt: string;
  sourceStockCount?: { countNo: string | null } | null;
  _count?: { lines: number };
}

const STATUS_OPTIONS = ["DRAFT", "SUBMITTED", "APPROVED", "APPLIED", "CANCELLED"] as const;

function AdjustmentList() {
  const [noInput, setNoInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ adjustmentNo?: string; status?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<AdjustmentRow>("/api/inventory-adjustments", filters);

  const applyFilter = () => {
    const next: { adjustmentNo?: string; status?: string } = {};
    if (noInput.trim()) next.adjustmentNo = noInput.trim();
    if (statusInput) next.status = statusInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setNoInput("");
    setStatusInput("");
    setFilters({});
    setPage(1);
  };

  return (
    <AppPage>
      <EntityListWorkspace<AdjustmentRow>
        title="库存调整"
        description="库存调整工作台"
        filters={
          <>
            <input
              value={noInput}
              onChange={(e) => setNoInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按调整单号搜索"
              className="w-40 rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            />
            <select
              value={statusInput}
              onChange={(e) => setStatusInput(e.target.value)}
              className="rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            >
              <option value="">全部状态</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </>
        }
        toolbarActions={
          <>
            <button
              type="button"
              onClick={applyFilter}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              查询
            </button>
            <button
              type="button"
              onClick={resetFilter}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-slate-50"
            >
              重置
            </button>
          </>
        }
        columns={[
          {
            key: "adjustmentNo",
            header: "调整单号",
            render: (row) => (
              <Link
                href={`/inventory/adjustments/${row.id}`}
                className="font-medium text-brand-600 hover:underline"
              >
                {row.adjustmentNo}
              </Link>
            ),
          },
          {
            key: "status",
            header: "状态",
            render: (row) => <StatusBadge status={row.status} />,
          },
          { key: "reasonCode", header: "原因码", render: (row) => row.reasonCode },
          {
            key: "sourceStockCount",
            header: "来源盘点",
            render: (row) => row.sourceStockCount?.countNo ?? "—",
          },
          {
            key: "lines",
            header: "行数",
            render: (row) => String(row._count?.lines ?? 0),
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
    <PermissionGuard permission={PERMISSIONS.INVENTORY_ADJUSTMENT_READ}>
      <AdjustmentList />
    </PermissionGuard>
  );
}
