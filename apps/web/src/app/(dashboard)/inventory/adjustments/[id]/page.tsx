"use client";

/**
 * Inventory Adjustments — 库存调整详情页（F2-3 Batch C2 Consolidation，CTO #11888）
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

interface AdjustmentDetail {
  id: string;
  adjustmentNo: string;
  status: string;
  reasonCode: string;
  appliedAt?: string | null;
  remark?: string | null;
  createdAt: string;
  sourceStockCount?: { countNo: string | null; status: string | null } | null;
  approvedBy?: { name: string | null } | null;
  appliedBy?: { name: string | null } | null;
  lines?: Array<{
    id: string;
    direction: string;
    quantity: string;
    batchNo?: string | null;
    serialNo?: string | null;
    item?: { code: string | null; name: string | null } | null;
    uom?: { symbol: string | null } | null;
    warehouse?: { name: string | null } | null;
    location?: { name: string | null } | null;
  }>;
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
}

function AdjustmentDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<AdjustmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<AdjustmentDetail>(`/api/inventory-adjustments/${id}`, { signal: controller.signal })
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
        <Link href="/inventory/adjustments" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          返回列表
        </Link>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <EntityDetailWorkspace
        title={`库存调整详情 — ${detail.adjustmentNo}`}
        backHref="/inventory/adjustments"
        status={detail.status}
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="调整单号" value={detail.adjustmentNo} />
            <InfoItem label="原因码" value={detail.reasonCode} />
            <InfoItem
              label="来源盘点"
              value={
                detail.sourceStockCount?.countNo
                  ? `${detail.sourceStockCount.countNo}${detail.sourceStockCount.status ? `（${detail.sourceStockCount.status}）` : ""}`
                  : null
              }
            />
            <InfoItem label="审批人" value={detail.approvedBy?.name} />
            <InfoItem label="应用人" value={detail.appliedBy?.name} />
            <InfoItem label="应用时间" value={formatDate(detail.appliedAt)} />
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
            <InfoItem label="备注" value={detail.remark} />
          </div>
        }
      >
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">
            调整行（{detail.lines?.length ?? 0}）
          </h2>
          <div className="overflow-x-auto">
            <table className="divide-border min-w-full divide-y text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium text-ink-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">仓库</th>
                  <th className="px-3 py-2 font-medium">库位</th>
                  <th className="px-3 py-2 font-medium">物料</th>
                  <th className="px-3 py-2 font-medium">方向</th>
                  <th className="px-3 py-2 font-medium">数量</th>
                  <th className="px-3 py-2 font-medium">单位</th>
                  <th className="px-3 py-2 font-medium">批次/序列号</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {(detail.lines ?? []).map((line) => (
                  <tr key={line.id}>
                    <td className="px-3 py-2 text-ink-secondary">{line.warehouse?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{line.location?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-primary">
                      {line.item ? `${line.item.code ?? ""} ${line.item.name ?? ""}`.trim() : "—"}
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{line.direction}</td>
                    <td className="px-3 py-2 text-ink-primary">{line.quantity}</td>
                    <td className="px-3 py-2 text-ink-secondary">{line.uom?.symbol ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{line.batchNo ?? line.serialNo ?? "—"}</td>
                  </tr>
                ))}
                {(detail.lines ?? []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-sm text-ink-muted">
                      暂无明细行
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </EntityDetailWorkspace>
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.INVENTORY_ADJUSTMENT_READ}>
      <AdjustmentDetailPage />
    </PermissionGuard>
  );
}
