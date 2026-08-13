"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { hasPermission, PERMISSIONS, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/format";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";

interface ReturnDetail {
  id: string;
  code: string;
  status: string;
  returnedAt?: string | null;
  remark?: string | null;
  createdAt: string;
  purchaseOrder?: { code: string | null; status: string | null } | null;
  supplier?: { name: string | null } | null;
  returnedBy?: { name: string | null } | null;
  lines?: Array<{
    id: string;
    quantity: string;
    sourceRefType?: string | null;
    item?: { code: string | null; name: string | null } | null;
    uom?: { symbol: string | null } | null;
    sourcePurchaseReceiptLine?: { lineNo: number | null; purchaseReceipt?: { code: string | null } | null } | null;
    sourceWarehouseReceiptLine?: { warehouseReceipt?: { code: string | null; status: string | null } | null } | null;
    sourceInspection?: { inspectionMode: string | null; result: string | null } | null;
  }>;
}

function ReturnDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const { state } = useSession();
  const canEdit =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], "purchase-return:edit");
  const [detail, setDetail] = useState<ReturnDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<ReturnDetail>(`/api/purchase-returns/${id}`, { signal: controller.signal })
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
        <h1 className="text-lg font-semibold text-slate-800">采购退货详情</h1>
        <div className="flex items-center gap-2">
          {detail?.status === "DRAFT" && canEdit && (
            <Link
              href={`/purchasing/returns/${id}/edit`}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              编辑
            </Link>
          )}
          <Link
            href="/purchasing/returns"
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            返回列表
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="p-6 text-sm text-slate-400">加载中…</div>
      ) : error ? (
        <div className="p-6">
          <p className="text-sm text-red-600">
            {describeStatus(error.status)}：{error.message}
            {error.code ? `（${error.code}）` : ""}
          </p>
          <Link href="/purchasing/returns" className="mt-2 inline-block text-sm text-brand-600">
            返回列表
          </Link>
        </div>
      ) : detail ? (
        <div className="p-4">
          <div className="mb-4 grid grid-cols-2 gap-4 rounded-md bg-slate-50 p-4 text-sm md:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500">退货单号</p>
              <p className="mt-1 font-medium text-slate-800">{detail.code}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">状态</p>
              <p className="mt-1">
                <StatusBadge status={detail.status} />
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">采购订单</p>
              <p className="mt-1 text-slate-700">{detail.purchaseOrder?.code ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">供应商</p>
              <p className="mt-1 text-slate-700">{detail.supplier?.name ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">退货人</p>
              <p className="mt-1 text-slate-700">{detail.returnedBy?.name ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">退货时间</p>
              <p className="mt-1 text-slate-700">{formatDate(detail.returnedAt)}</p>
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
                <th className="px-4 py-3">来源类型</th>
                <th className="px-4 py-3">物料</th>
                <th className="px-4 py-3">数量</th>
                <th className="px-4 py-3">单位</th>
                <th className="px-4 py-3">来源单据</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(detail.lines ?? []).map((line) => (
                <tr key={line.id}>
                  <td className="px-4 py-3 text-slate-600">{line.sourceRefType ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {line.item ? `${line.item.code ?? ""} ${line.item.name ?? ""}`.trim() : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{line.quantity}</td>
                  <td className="px-4 py-3 text-slate-600">{line.uom?.symbol ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {line.sourcePurchaseReceiptLine?.purchaseReceipt?.code ??
                      line.sourceWarehouseReceiptLine?.warehouseReceipt?.code ??
                      "—"}
                  </td>
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
    <PermissionGuard permission={PERMISSIONS.PURCHASE_RETURN_READ}>
      <ReturnDetailPage />
    </PermissionGuard>
  );
}
