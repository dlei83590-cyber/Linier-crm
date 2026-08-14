"use client";

/**
 * Inspections — 质检记录详情页（F2-3 Batch C1 Consolidation，CTO #11888）
 *
 * 由旧式布局迁移至统一 Workspace：
 * AppPage → EntityDetailWorkspace（Header Summary → Status → Actions → Sections）。
 * 不改 backend / 状态机 / action。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PERMISSIONS } from "@nilier-crm/shared";
import { AppPage, EntityDetailWorkspace, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";

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

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
}

function InspectionDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
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
        setError(
          err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id]);

  if (loading) {
    return (
      <AppPage>
        <div className="border-border bg-surface rounded-lg border p-6 text-sm text-ink-muted">
          加载中…
        </div>
      </AppPage>
    );
  }

  if (error || !detail) {
    return (
      <AppPage>
        <ErrorPanel error={error} />
        <Link href="/purchasing/inspections" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          返回列表
        </Link>
      </AppPage>
    );
  }

  const src = detail.purchaseReceiptLine;

  return (
    <AppPage>
      <EntityDetailWorkspace
        title={`质检记录详情 — ${detail.inspectionMode}`}
        backHref="/purchasing/inspections"
        status={detail.result}
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="质检模式" value={detail.inspectionMode} />
            <InfoItem label="合格数量" value={detail.qualifiedQty} />
            <InfoItem label="拒收数量" value={detail.rejectedQty} />
            <InfoItem label="质检人" value={detail.inspectedBy?.name} />
            <InfoItem label="质检时间" value={formatDate(detail.inspectedAt)} />
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
            <InfoItem label="备注" value={detail.remark} />
          </div>
        }
      >
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">来源收货行</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem
              label="收货单"
              value={
                src?.purchaseReceipt?.code
                  ? `${src.purchaseReceipt.code}${src.purchaseReceipt.status ? `（${src.purchaseReceipt.status}）` : ""}`
                  : null
              }
            />
            <InfoItem label="行号" value={src?.lineNo} />
            <InfoItem
              label="物料"
              value={src?.item ? `${src.item.code ?? ""} ${src.item.name ?? ""}`.trim() : null}
            />
            <InfoItem label="单位" value={src?.uom?.symbol} />
            <InfoItem label="到货数量" value={src?.quantity} />
            <InfoItem label="现场拒收" value={src?.rejectedOnReceiptQty ?? "0"} />
            <InfoItem label="可见损坏" value={src?.visibleDamageQty ?? "0"} />
            <InfoItem
              label="PO 行"
              value={
                src?.purchaseOrderLine
                  ? `L${src.purchaseOrderLine.lineNo ?? ""}（${src.purchaseOrderLine.fulfillmentType ?? ""}）`
                  : null
              }
            />
          </div>
        </section>
      </EntityDetailWorkspace>
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.INSPECTION_READ}>
      <InspectionDetailPage />
    </PermissionGuard>
  );
}
