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

interface InspectionRow {
  id: string;
  inspectionMode: string;
  result: string;
  qualifiedQty: string;
  rejectedQty: string;
  createdAt: string;
  inspectedBy?: { name: string | null } | null;
  purchaseReceiptLine?: {
    lineNo: number;
    purchaseReceipt?: { code: string | null } | null;
    item?: { code: string | null; name: string | null } | null;
    uom?: { symbol: string | null } | null;
  } | null;
}

const MODE_OPTIONS = ["SKIP", "SPOT", "FULL"] as const;
const RESULT_OPTIONS = ["QUALIFIED", "PARTIAL", "REJECTED", "PENDING"] as const;

function InspectionList() {
  const [modeInput, setModeInput] = useState("");
  const [resultInput, setResultInput] = useState("");
  const [filters, setFilters] = useState<{ inspectionMode?: string; result?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<InspectionRow>("/api/inspections", filters);

  const applyFilter = () => {
    const next: { inspectionMode?: string; result?: string } = {};
    if (modeInput) next.inspectionMode = modeInput;
    if (resultInput) next.result = resultInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setModeInput("");
    setResultInput("");
    setFilters({});
    setPage(1);
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4">
        <h1 className="mr-4 text-lg font-semibold text-slate-800">质检记录</h1>
        <select
          value={modeInput}
          onChange={(e) => setModeInput(e.target.value)}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
        >
          <option value="">全部质检模式</option>
          {MODE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={resultInput}
          onChange={(e) => setResultInput(e.target.value)}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
        >
          <option value="">全部结果</option>
          {RESULT_OPTIONS.map((s) => (
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
              <th className="px-4 py-3">收货单</th>
              <th className="px-4 py-3">行号</th>
              <th className="px-4 py-3">物料</th>
              <th className="px-4 py-3">质检模式</th>
              <th className="px-4 py-3">结果</th>
              <th className="px-4 py-3">合格数量</th>
              <th className="px-4 py-3">拒收数量</th>
              <th className="px-4 py-3">质检人</th>
              <th className="px-4 py-3">创建时间</th>
              <th className="px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <LoadingRow colSpan={10} />
            ) : error ? (
              <ErrorRow colSpan={10} error={error} onRetry={refresh} />
            ) : items.length === 0 ? (
              <EmptyRow colSpan={10} />
            ) : (
              items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {item.purchaseReceiptLine?.purchaseReceipt?.code ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{item.purchaseReceiptLine?.lineNo ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {item.purchaseReceiptLine?.item
                      ? `${item.purchaseReceiptLine.item.code ?? ""} ${item.purchaseReceiptLine.item.name ?? ""}`.trim()
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{item.inspectionMode}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={item.result} />
                  </td>
                  <td className="px-4 py-3 text-slate-700">{item.qualifiedQty}</td>
                  <td className="px-4 py-3 text-slate-700">{item.rejectedQty}</td>
                  <td className="px-4 py-3 text-slate-600">{item.inspectedBy?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(item.createdAt)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/purchasing/inspections/${item.id}`} className="text-brand-600 hover:text-brand-700">
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
    <PermissionGuard permission={PERMISSIONS.INSPECTION_READ}>
      <InspectionList />
    </PermissionGuard>
  );
}
