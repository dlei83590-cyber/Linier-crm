"use client";

import { useState } from "react";
import Link from "next/link";
import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { StatusBadge } from "@/components/ui/status-badge";
import { Pagination } from "@/components/ui/pagination";
import { EmptyRow, ErrorRow, LoadingRow } from "@/components/ui/list-states";
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
  const [adjustmentNoInput, setAdjustmentNoInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ adjustmentNo?: string; status?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<AdjustmentRow>("/api/inventory-adjustments", filters);

  const applyFilter = () => {
    const next: { adjustmentNo?: string; status?: string } = {};
    if (adjustmentNoInput.trim()) next.adjustmentNo = adjustmentNoInput.trim();
    if (statusInput) next.status = statusInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setAdjustmentNoInput("");
    setStatusInput("");
    setFilters({});
    setPage(1);
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4">
        <h1 className="mr-4 text-lg font-semibold text-slate-800">库存调整</h1>
        <input
          value={adjustmentNoInput}
          onChange={(e) => setAdjustmentNoInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") applyFilter();
          }}
          placeholder="按调整单号搜索"
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
        />
        <select
          value={statusInput}
          onChange={(e) => setStatusInput(e.target.value)}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
        >
          <option value="">全部状态</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
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
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          重置
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
            <tr>
              <th className="px-4 py-3">调整单号</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">原因码</th>
              <th className="px-4 py-3">来源盘点</th>
              <th className="px-4 py-3">行数</th>
              <th className="px-4 py-3">创建时间</th>
              <th className="px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <LoadingRow colSpan={7} />
            ) : error ? (
              <ErrorRow colSpan={7} error={error} onRetry={refresh} />
            ) : items.length === 0 ? (
              <EmptyRow colSpan={7} />
            ) : (
              items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{item.adjustmentNo}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">{item.reasonCode}</td>
                  <td className="px-4 py-3 text-slate-600">{item.sourceStockCount?.countNo ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{item._count?.lines ?? 0}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(item.createdAt)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/inventory/adjustments/${item.id}`} className="text-brand-600 hover:text-brand-700">
                      查看
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
    </div>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.INVENTORY_ADJUSTMENT_READ}>
      <AdjustmentList />
    </PermissionGuard>
  );
}
