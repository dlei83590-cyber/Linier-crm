"use client";

/**
 * Inventory Read Model — 库存流水详情页（Read Model Gate FINAL，CTO Directive 2026-08-12 §15/§16）
 *
 * 只读 Trace / Audit：展示单条不可变账本事实（InventoryMovement），含来源链
 * （sourceType/sourceId/sourceLineId + movementGroupId + reversal/correction 引用）。
 * 前端不聚合、不计算余额；余额以 Stock Projection 页为准（§14）。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PERMISSIONS } from "@nilier-crm/shared";
import { AppPage, ErrorPanel, StatusBadge } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";

interface MovementDetail {
  id: string;
  movementNo: string;
  sourceType: string;
  sourceId: string;
  sourceLineId: string;
  movementRole: string;
  movementAtomKey: string;
  movementGroupId?: string | null;
  direction: string;
  status: string;
  movementType: string;
  reversalOfMovementId?: string | null;
  correctionOfMovementId?: string | null;
  warehouse?: { id: string; name: string | null } | null;
  location?: { id: string; name: string | null } | null;
  item?: { id: string; code: string | null; name: string | null } | null;
  batchNo?: string | null;
  serialNo?: string | null;
  mfgDate?: string | null;
  expDate?: string | null;
  quantity: string;
  uom?: { id: string; code: string | null; name: string | null } | null;
  referenceNo?: string | null;
  remark?: string | null;
  committedAt: string;
  committedById?: string | null;
  createdAt: string;
  updatedAt: string;
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 break-all text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-border bg-surface shadow-elevation-sm rounded-lg border p-5">
      <h2 className="text-ink-primary mb-3 text-sm font-semibold">{title}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

function MovementDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<MovementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<MovementDetail>(`/api/inventory-movements/${id}`, { signal: controller.signal })
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

  return (
    <AppPage>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-ink-muted">
            <Link href="/inventory/ledger" className="hover:underline">
              ← 库存流水
            </Link>
          </p>
          <h1 className="text-ink-primary mt-1 text-xl font-semibold">流水详情 {detail ? detail.movementNo : ""}</h1>
        </div>
      </div>

      {loading ? <p className="text-sm text-ink-muted">加载中…</p> : null}
      {error ? <ErrorPanel error={error} /> : null}
      {!loading && !error && detail ? (
        <div className="space-y-4">
          <Section title="账本事实">
            <InfoItem label="流水号" value={detail.movementNo} />
            <InfoItem label="方向" value={<StatusBadge status={detail.direction} tone={detail.direction === "IN" ? "success" : "danger"} />} />
            <InfoItem label="类型" value={detail.movementType} />
            <InfoItem label="来源类型" value={detail.sourceType} />
            <InfoItem label="状态" value={<StatusBadge status={detail.status} />} />
            <InfoItem label="入账时间" value={formatDate(detail.committedAt)} />
            <InfoItem label="数量" value={`${detail.quantity}${detail.uom?.name ? ` ${detail.uom.name}` : ""}`} />
            <InfoItem label="业务单号" value={detail.referenceNo} />
          </Section>

          <Section title="维度">
            <InfoItem
              label="物料"
              value={detail.item ? `${detail.item.code ?? ""} ${detail.item.name ?? ""}`.trim() : "—"}
            />
            <InfoItem label="仓库" value={detail.warehouse?.name} />
            <InfoItem label="库位" value={detail.location?.name} />
            <InfoItem label="批次" value={detail.batchNo} />
            <InfoItem label="序列号" value={detail.serialNo} />
            <InfoItem label="生产日期" value={formatDate(detail.mfgDate)} />
            <InfoItem label="有效期至" value={formatDate(detail.expDate)} />
          </Section>

          <Section title="来源与追溯">
            <InfoItem label="来源单据 ID" value={detail.sourceId} />
            <InfoItem label="来源行 ID" value={detail.sourceLineId} />
            <InfoItem label="行内角色" value={detail.movementRole} />
            <InfoItem label="原子键" value={detail.movementAtomKey} />
            <InfoItem label="编组 ID" value={detail.movementGroupId} />
            <InfoItem label="冲销来源" value={detail.reversalOfMovementId} />
            <InfoItem label="更正来源" value={detail.correctionOfMovementId} />
            <InfoItem label="备注" value={detail.remark} />
          </Section>
        </div>
      ) : null}
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.INVENTORY_MOVEMENT_READ}>
      <MovementDetailPage />
    </PermissionGuard>
  );
}
