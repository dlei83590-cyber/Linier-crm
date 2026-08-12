"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/format";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";

interface RequisitionDetail {
  id: string;
  code: string;
  status: string;
  remark?: string | null;
  needDate?: string | null;
  createdAt: string;
  requester?: { name: string | null } | null;
  department?: { name: string | null } | null;
  lines?: Array<{
    id: string;
    lineNo: number;
    description: string;
    quantity: string;
    needDate?: string | null;
    item?: { code: string | null; name: string | null } | null;
    uom?: { symbol: string | null } | null;
  }>;
}


function RequisitionDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<RequisitionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<RequisitionDetail>(`/api/purchase-requisitions/${id}`, { signal: controller.signal })
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
        <h1 className="text-lg font-semibold text-slate-800">采购申请详情</h1>
        <Link
          href="/purchasing/requisitions"
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
          <Link href="/purchasing/requisitions" className="mt-2 inline-block text-sm text-brand-600">
            返回列表
          </Link>
        </div>
      ) : detail ? (
        <div className="p-4">
          <div className="mb-4 grid grid-cols-2 gap-4 rounded-md bg-slate-50 p-4 text-sm md:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500">单号</p>
              <p className="mt-1 font-medium text-slate-800">{detail.code}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">状态</p>
              <p className="mt-1">
                <StatusBadge status={detail.status} />
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">申请人</p>
              <p className="mt-1 text-slate-700">{detail.requester?.name ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">部门</p>
              <p className="mt-1 text-slate-700">{detail.department?.name ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">期望日期</p>
              <p className="mt-1 text-slate-700">{formatDate(detail.needDate)}</p>
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
                <th className="px-4 py-3">行号</th>
                <th className="px-4 py-3">物料</th>
                <th className="px-4 py-3">需求描述</th>
                <th className="px-4 py-3">数量</th>
                <th className="px-4 py-3">单位</th>
                <th className="px-4 py-3">需求日期</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(detail.lines ?? []).map((line) => (
                <tr key={line.id}>
                  <td className="px-4 py-3 text-slate-600">{line.lineNo}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {line.item ? `${line.item.code ?? ""} ${line.item.name ?? ""}`.trim() : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{line.description}</td>
                  <td className="px-4 py-3 text-slate-700">{line.quantity}</td>
                  <td className="px-4 py-3 text-slate-600">{line.uom?.symbol ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(line.needDate)}</td>
                </tr>
              ))}
              {(detail.lines ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
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
    <PermissionGuard permission={PERMISSIONS.PURCHASE_REQUISITION_READ}>
      <RequisitionDetailPage />
    </PermissionGuard>
  );
}
