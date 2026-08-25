"use client";

/**
 * Audit Log Detail — 操作日志详情页（F2-6B 批 3，只读）
 *
 * 消费 FINAL 契约 GET /api/audit-logs/{id}（含 beforeData/afterData 快照）。
 * PermissionGuard 对齐 API requirePermission("audit:view")。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityDetailWorkspace, ErrorPanel } from "@/components/workspace";
import { PageLoading } from "@/components/ui/skeleton";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";

interface AuditLogDetail {
  id: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  result: string;
  requestId?: string | null;
  traceId?: string | null;
  ip?: string | null;
  device?: string | null;
  browser?: string | null;
  durationMs?: number | null;
  beforeData?: unknown;
  afterData?: unknown;
  createdAt: string;
  actor?: { id: string; email: string; name: string | null } | null;
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 break-all text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
}

function DataBlock({ title, data }: { title: string; data: unknown }) {
  return (
    <section className="border-border rounded-md border p-4">
      <h2 className="text-ink-primary mb-3 text-sm font-semibold">{title}</h2>
      <pre className="text-ink-secondary overflow-x-auto rounded-md bg-canvas p-3 text-xs">
        {data === undefined || data === null ? "—" : JSON.stringify(data, null, 2)}
      </pre>
    </section>
  );
}

function AuditLogDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<AuditLogDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<AuditLogDetail>(`/api/audit-logs/${id}`, { signal: controller.signal })
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
        <div className="border-border bg-surface overflow-hidden rounded-lg border">
          <PageLoading rows={5} />
        </div>
      </AppPage>
    );
  }

  if (error || !detail) {
    return (
      <AppPage>
        <ErrorPanel error={error} />
        <Link href="/audit-logs" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          返回列表
        </Link>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <EntityDetailWorkspace
        title={`审计日志详情 — ${detail.action}`}
        backHref="/audit-logs"
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="操作" value={detail.action} />
            <InfoItem label="实体类型" value={detail.entityType} />
            <InfoItem label="实体 ID" value={detail.entityId} />
            <InfoItem label="结果" value={detail.result} />
            <InfoItem label="操作人" value={detail.actor?.name ?? detail.actor?.email} />
            <InfoItem label="requestId" value={detail.requestId} />
            <InfoItem label="traceId" value={detail.traceId} />
            <InfoItem label="时间" value={formatDate(detail.createdAt)} />
            <InfoItem label="IP" value={detail.ip} />
            <InfoItem label="设备" value={detail.device} />
            <InfoItem label="浏览器" value={detail.browser} />
            <InfoItem label="耗时(ms)" value={detail.durationMs} />
          </div>
        }
      >
        <div className="space-y-4">
          <DataBlock title="变更前（beforeData）" data={detail.beforeData} />
          <DataBlock title="变更后（afterData）" data={detail.afterData} />
        </div>
      </EntityDetailWorkspace>
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("audit", "view")}>
      <AuditLogDetailPage />
    </PermissionGuard>
  );
}
