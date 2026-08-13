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

interface InspectionDetail {
  id: string;
  inspectionMode: string;
  result: string;
  qualifiedQty: string;
  rejectedQty: string;
  inspectedAt?: string | null;
  remark?: string | null;
  createdAt: string;
  inspectedBy?: { name: string | null } | null;
  purchaseReceiptLine?: {
    lineNo: number;
    quantity: string;
    rejectedOnReceiptQty: string;
    visibleDamageQty: string;
    purchaseReceipt?: { code: string | null; status: string | null; receivedAt?: string | null } | null;
    purchaseOrderLine?: { lineNo: number | null; quantity: string | null; fulfillmentType: string | null } | null;
    item?: { code: string | null; name: string | null; model: string | null } | null;
    uom?: { code: string | null; symbol: string | null } | null;
  } | null;
}

function InspectionDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const { state } = useSession();
  const canEdit =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], "inspection:edit");
  const [detail, setDetail] = useState<InspectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<InspectionDetail>(`/api/inspections/${id}`, { signal: controller.signal })
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
        <h1 className="text-lg font-semibold text-slate-800">质检记录详情</h1>
        <div className="flex items-center gap-2">
          {detail?.result === "PENDING" && canEdit && (
            <Link
              href={`/purchasing/inspections/${id}/edit`}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              编辑
            </Link>
          )}
          <Link
            href="/purchasing/inspections"
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
          <Link href="/purchasing/inspections" className="mt-2 inline-block text-sm text-brand-600">
            返回列表
          </Link>
        </div>
      ) : detail ? (
        <div className="p-4">
          <div className="mb-4 grid grid-cols-2 gap-4 rounded-md bg-slate-50 p-4 text-sm md:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500">质检模式</p>
              <p className="mt-1 font-medium text-slate-800">{detail.inspectionMode}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">结果</p>
              <p className="mt-1">
                <StatusBadge status={detail.result} />
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">合格数量</p>
              <p className="mt-1 text-slate-700">{detail.qualifiedQty}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">拒收数量</p>
              <p className="mt-1 text-slate-700">{detail.rejectedQty}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">质检人</p>
              <p className="mt-1 text-slate-700">{detail.inspectedBy?.name ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">质检时间</p>
              <p className="mt-1 text-slate-700">{formatDate(detail.inspectedAt)}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-slate-500">备注</p>
              <p className="mt-1 text-slate-700">{detail.remark ?? "—"}</p>
            </div>
          </div>

          <div className="mb-4 rounded-md border border-slate-200">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700">
              来源收货行
            </div>
            <div className="grid grid-cols-2 gap-4 p-4 text-sm md:grid-cols-4">
              <div>
                <p className="text-xs text-slate-500">收货单</p>
                <p className="mt-1 text-slate-700">
                  {detail.purchaseReceiptLine?.purchaseReceipt?.code ?? "—"}
                  {detail.purchaseReceiptLine?.purchaseReceipt?.status
                    ? `（${detail.purchaseReceiptLine.purchaseReceipt.status}）`
                    : ""}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">行号</p>
                <p className="mt-1 text-slate-700">{detail.purchaseReceiptLine?.lineNo ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">物料</p>
                <p className="mt-1 text-slate-700">
                  {detail.purchaseReceiptLine?.item
                    ? `${detail.purchaseReceiptLine.item.code ?? ""} ${detail.purchaseReceiptLine.item.name ?? ""}`.trim()
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">单位</p>
                <p className="mt-1 text-slate-700">{detail.purchaseReceiptLine?.uom?.symbol ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">到货数量</p>
                <p className="mt-1 text-slate-700">{detail.purchaseReceiptLine?.quantity ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">现场拒收</p>
                <p className="mt-1 text-slate-700">{detail.purchaseReceiptLine?.rejectedOnReceiptQty ?? "0"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">可见损坏</p>
                <p className="mt-1 text-slate-700">{detail.purchaseReceiptLine?.visibleDamageQty ?? "0"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">PO 行</p>
                <p className="mt-1 text-slate-700">
                  {detail.purchaseReceiptLine?.purchaseOrderLine?.lineNo ?? "—"}
                  {detail.purchaseReceiptLine?.purchaseOrderLine?.fulfillmentType
                    ? `（${detail.purchaseReceiptLine.purchaseOrderLine.fulfillmentType}）`
                    : ""}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.INSPECTION_READ}>
      <InspectionDetailPage />
    </PermissionGuard>
  );
}
