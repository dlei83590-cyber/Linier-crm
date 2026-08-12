"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/format";

interface TransferDetail {
  id: string;
  transferNo: string;
  status: string;
  transferType?: string | null;
  movementGroupId?: string | null;
  remark?: string | null;
  createdAt: string;
  executedAt?: string | null;
  sourceWarehouse?: { name: string | null } | null;
  sourceLocation?: { name: string | null } | null;
  destinationWarehouse?: { name: string | null } | null;
  destinationLocation?: { name: string | null } | null;
  approvedBy?: { name: string | null } | null;
  executedBy?: { name: string | null } | null;
  lines?: Array<{
    id: string;
    quantity: string;
    batchNo?: string | null;
    remark?: string | null;
    item?: { code: string | null; name: string | null } | null;
    uom?: { symbol: string | null } | null;
  }>;
}


function TransferDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<TransferDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/inventory-transfers/${id}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          let message = `请求失败（${res.status}）`;
          try {
            const body = (await res.json()) as { error?: { message?: string } };
            message = body.error?.message ?? message;
          } catch {
            // 保留默认错误消息
          }
          throw new Error(message);
        }
        const body = (await res.json()) as { success: boolean; data: TransferDetail };
        if (!body.success) throw new Error("加载失败");
        setDetail(body.data);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "加载失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 p-4">
        <h1 className="text-lg font-semibold text-slate-800">库存调拨详情</h1>
        <Link
          href="/inventory/transfers"
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          返回列表
        </Link>
      </div>

      {loading ? (
        <div className="p-6 text-sm text-slate-400">加载中…</div>
      ) : error ? (
        <div className="p-6">
          <p className="text-sm text-red-600">{error}</p>
          <Link href="/inventory/transfers" className="mt-2 inline-block text-sm text-brand-600">
            返回列表
          </Link>
        </div>
      ) : detail ? (
        <div className="p-4">
          <div className="mb-4 grid grid-cols-2 gap-4 rounded-md bg-slate-50 p-4 text-sm md:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500">调拨单号</p>
              <p className="mt-1 font-medium text-slate-800">{detail.transferNo}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">状态</p>
              <p className="mt-1">
                <StatusBadge status={detail.status} />
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">调拨类型</p>
              <p className="mt-1 text-slate-700">{detail.transferType ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Movement Group</p>
              <p className="mt-1 text-slate-700">{detail.movementGroupId ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">源仓库</p>
              <p className="mt-1 text-slate-700">
                {detail.sourceWarehouse?.name ?? "—"}
                {detail.sourceLocation ? ` / ${detail.sourceLocation.name}` : ""}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">目标仓库</p>
              <p className="mt-1 text-slate-700">
                {detail.destinationWarehouse?.name ?? "—"}
                {detail.destinationLocation ? ` / ${detail.destinationLocation.name}` : ""}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">创建时间</p>
              <p className="mt-1 text-slate-700">{formatDate(detail.createdAt)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">执行时间</p>
              <p className="mt-1 text-slate-700">{formatDate(detail.executedAt)}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-slate-500">备注</p>
              <p className="mt-1 text-slate-700">{detail.remark ?? "—"}</p>
            </div>
          </div>

          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
              <tr>
                <th className="px-4 py-3">物料</th>
                <th className="px-4 py-3">数量</th>
                <th className="px-4 py-3">单位</th>
                <th className="px-4 py-3">批次</th>
                <th className="px-4 py-3">备注</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(detail.lines ?? []).map((line) => (
                <tr key={line.id}>
                  <td className="px-4 py-3 text-slate-700">
                    {line.item ? `${line.item.code ?? ""} ${line.item.name ?? ""}`.trim() : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{line.quantity}</td>
                  <td className="px-4 py-3 text-slate-600">{line.uom?.symbol ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{line.batchNo ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{line.remark ?? "—"}</td>
                </tr>
              ))}
              {(detail.lines ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">
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
    <PermissionGuard permission={PERMISSIONS.INVENTORY_TRANSFER_READ}>
      <TransferDetailPage />
    </PermissionGuard>
  );
}
