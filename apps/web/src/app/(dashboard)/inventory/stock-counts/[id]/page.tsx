"use client";

/**
 * Stock Counts — 库存盘点详情页（F2-3 Batch C2 Consolidation，CTO #11888）
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

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
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
        <Link href="/inventory/stock-counts" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          返回列表
        </Link>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <EntityDetailWorkspace
        title={`库存盘点详情 — ${detail.countNo}`}
        backHref="/inventory/stock-counts"
        status={detail.status}
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="盘点单号" value={detail.countNo} />
            <InfoItem label="盘点人" value={detail.countedBy?.name} />
            <InfoItem label="完成时间" value={formatDate(detail.completedAt)} />
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
            <InfoItem label="备注" value={detail.remark} />
          </div>
        }
      >
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">
            盘点行（{detail.lines?.length ?? 0}）
          </h2>
          <div className="overflow-x-auto">
            <table className="divide-border min-w-full divide-y text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium text-ink-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">仓库</th>
                  <th className="px-3 py-2 font-medium">库位</th>
                  <th className="px-3 py-2 font-medium">物料</th>
                  <th className="px-3 py-2 font-medium">批次/序列号</th>
                  <th className="px-3 py-2 font-medium">实盘数量</th>
                  <th className="px-3 py-2 font-medium">账面数量</th>
                  <th className="px-3 py-2 font-medium">差异</th>
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
                    <td className="px-3 py-2 text-ink-secondary">{line.batchNo ?? line.serialNo ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-primary">{line.countedQty}</td>
                    <td className="px-3 py-2 text-ink-primary">{line.bookQtyAtCount}</td>
                    <td className="px-3 py-2 text-ink-primary">{line.varianceQty ?? "—"}</td>
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
    <PermissionGuard permission={PERMISSIONS.STOCK_COUNT_READ}>
      <StockCountDetailPage />
    </PermissionGuard>
  );
}
