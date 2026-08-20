"use client";

/**
 * Accounts Receivable Detail — 应收账款详情页（F2-6A Sales Read Foundation）
 *
 * 只读 Detail：AppPage → EntityDetailWorkspace（Header → Summary）。
 * AR 纯只读（1:1 绑定 Invoice），无写动作、无明细行。
 * 展示惰性投影 effectiveStatus / effectiveAgingBucket。
 * PermissionGuard 对齐 API requirePermission("accounts-receivable:view")。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { actionPermission } from "@nilier-crm/shared";
import type { StatusTone } from "@/components/design-system";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityDetailWorkspace, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { formatDate, formatMoney } from "@/lib/format";

const TONE_MAP: Record<string, StatusTone> = {
  OPEN: "warning",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  OVERDUE: "danger",
  CLOSED: "neutral",
};

/** 状态中文业务名（Business UX Rationalization：枚举展示中文，不展示数据库枚举值；key 保留真实 enum） */
const STATUS_LABELS: Record<string, string> = {
  OPEN: "未结清",
  PARTIALLY_PAID: "部分收款",
  PAID: "已结清",
  OVERDUE: "已逾期",
  CLOSED: "已关闭",
};

interface ArDetail {
  id: string;
  status: string;
  effectiveStatus?: string;
  isOverdue?: boolean;
  currency: string;
  paidAmount: string;
  balanceAmount: string;
  dueDate?: string | null;
  effectiveAgingBucket?: string | null;
  customer?: { id: string; code: string | null; name: string | null } | null;
  invoice?: {
    id: string;
    code: string | null;
    status: string | null;
    invoiceDate?: string | null;
    dueDate?: string | null;
    invoiceTotal: string | null;
    paidAmount: string | null;
    balanceAmount: string | null;
    deliveryId?: string | null;
    salesOrderId?: string | null;
  } | null;
  createdAt: string;
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
}

function ArDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<ArDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<ArDetail>(`/api/accounts-receivables/${id}`, { signal: controller.signal })
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
        <Link href="/sales/accounts-receivable" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          返回列表
        </Link>
      </AppPage>
    );
  }

  const displayStatus = detail.effectiveStatus ?? detail.status;

  return (
    <AppPage>
      <EntityDetailWorkspace
        title={`应收账款详情 — ${detail.invoice?.code ?? "（草稿）"}`}
        backHref="/sales/accounts-receivable"
        status={displayStatus}
        statusLabel={STATUS_LABELS[displayStatus] ?? displayStatus}
        statusTone={TONE_MAP[displayStatus] ?? "neutral"}
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem
              label="关联发票"
              value={
                detail.invoice ? (
                  <Link
                    href={`/sales/invoices/${detail.invoice.id}`}
                    className="text-brand-600 hover:underline"
                  >
                    {detail.invoice.code ?? "（草稿）"}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            <InfoItem label="客户" value={detail.customer?.name} />
            <InfoItem label="到期日" value={formatDate(detail.dueDate)} />
            <InfoItem label="币种" value={detail.currency} />
            <InfoItem label="发票金额" value={formatMoney(detail.invoice?.invoiceTotal, detail.currency)} />
            <InfoItem label="已收款" value={formatMoney(detail.paidAmount, detail.currency)} />
            <InfoItem label="应收余额" value={formatMoney(detail.balanceAmount, detail.currency)} />
            <InfoItem label="账龄" value={detail.effectiveAgingBucket ?? "—"} />
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
          </div>
        }
      >
        <section className="border-border rounded-md border p-4">
          <p className="text-sm text-ink-muted">
            应收账款为只读模型，1:1 绑定销售发票；收款核销（Receipt Allocation）属 F2-6B 范围。
          </p>
        </section>
      </EntityDetailWorkspace>
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("accounts-receivable", "view")}>
      <ArDetailPage />
    </PermissionGuard>
  );
}
