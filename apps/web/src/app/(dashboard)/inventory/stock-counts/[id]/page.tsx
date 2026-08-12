"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/format";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";

interface StockCountDetail {
  id: string;
  countNo: string;
  status: string;
  completedAt?: string | null;
  remark?: string | null;
  createdAt: string;
  countedBy?: { name: string | null } | null;
  lines?: Array<{
    id: string;
    countedQty: string;
    bookQtyAtCount: string;
    varianceQty?: string | null;
    batchNo?: string | null;
    serialNo?: string | null;
    item?: { code: string | null; name: string | null } | null;
    warehouse?: { name: string | null } | null;
    location?: { name: string | null } | null;
  }>;
}

function StockCountDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<StockCountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<StockCountDetail>(`/api/stock-counts/${id}`, { signal: controller.signal })
      .then((body) => setDetail(body.data))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 p-4">
        <h1 className="text-lg font-semibold text-slate-800">库存盘点详情</h1>
        <Link
          href="/inventory/stock-counts"
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          返回列表
        </Link>
      </div>

      {loading ? (
        <div className="p-6 text-sm text-slate-400">加载中…</div>
      ) : error ? (
        <div className="p-6">
          <p className="text-sm text-red-600">
            {describeStatus(error.status)}：{error.message}
            {error.code ? `（${error.code}）` : ""}
          </p>
          <Link href="/inventory/stock-counts" className="mt-2 inline-block text-sm text-brand-600">
            返回列表
          </Link>
        </div>
      ) : detail ? (
        <div className="p-4">
          <div className="mb-4 grid grid-cols-2 gap-4 rounded-md bg-slate-50 p-4 text-sm md:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500">盘点单号</p>
              <p className="mt-1 font-medium text-slate-800">{detail.countNo}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">状态</p>
              <p className="mt-1">
                <StatusBadge status={detail.status} />
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">盘点人</p>
              <p className="mt-1 text-slate-700">{detail.countedBy?.name ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">完成时间</p>
              <p className="mt-1 text-slate-700">{formatDate(detail.completedAt)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">创建时间</p>
              <p className="mt-1 text-slate-700">{formatDate(detail.createdAt)}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-slate-500">备注</p>
              <p className="mt-1 text-slate-700">{detail.remark ?? "—"}</p>
            </div>
          </div>

          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
              <tr>
                <th className="px-4 py-3">仓库</th>
                <th className="px-4 py-3">库位</th>
                <th className="px-4 py-3">物料</th>
                <th className="px-4 py-3">批次</th>
                <th className="px-4 py-3">实盘数</th>
                <th className="px-4 py-3">账面数</th>
                <th className="px-4 py-3">差异</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(detail.lines ?? []).map((line) => (
                <tr key={line.id}>
                  <td className="px-4 py-3 text-slate-600">{line.warehouse?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{line.location?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {line.item ? `${line.item.code ?? ""} ${line.item.name ?? ""}`.trim() : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{line.batchNo ?? line.serialNo ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-700">{line.countedQty}</td>
                  <td className="px-4 py-3 text-slate-700">{line.bookQtyAtCount}</td>
                  <td className="px-4 py-3 text-slate-700">{line.varianceQty ?? "—"}</td>
                </tr>
              ))}
              {(detail.lines ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">
                    暂无明细行
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.STOCK_COUNT_READ}>
      <StockCountDetailPage />
    </PermissionGuard>
  );
}
