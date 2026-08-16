"use client";

/**
 * Sales Invoice Detail — 销售发票详情页（F2-6A Sales Read Foundation）
 *
 * 只读 Detail：AppPage → EntityDetailWorkspace（Header → Summary → Lines）。
 * 不开放 issue/cancel 等 factActions（F2-6B）；不提供 Edit 入口。
 * PermissionGuard 对齐 API requirePermission("invoice:view")。
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
  DRAFT: "neutral",
  ISSUED: "info",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  CANCELLED: "danger",
};

interface InvoiceLine {
  id: string;
  lineNo: number;
  description?: string | null;
  quantity: string;
  unitPrice: string;
  item?: { id: string; code: string | null; name: string | null; model?: string | null } | null;
}

interface InvoiceDetail {
  id: string;
  code: string | null;
  status: string;
  invoiceDate: string;
  dueDate?: string | null;
  currency: string;
  invoiceTotal: string;
  paidAmount: string;
  balanceAmount: string;
  remark?: string | null;
  customer?: { id: string; code: string | null; name: string | null } | null;
  delivery?: {
    id: string;
    code: string | null;
    status: string | null;
    deliveryDate?: string | null;
    salesOrder?: { id: string; code: string | null; status: string | null; currency: string | null } | null;
  } | null;
  lines?: InvoiceLine[];
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

function InvoiceDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<InvoiceDetail>(`/api/invoices/${id}`, { signal: controller.signal })
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
        <Link href="/sales/invoices" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          返回列表
        </Link>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <EntityDetailWorkspace
        title={`销售发票详情 — ${detail.code ?? "（草稿）"}`}
        backHref="/sales/invoices"
        status={detail.status}
        statusLabel={detail.status}
        statusTone={TONE_MAP[detail.status] ?? "neutral"}
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="单号" value={detail.code ?? "（草稿）"} />
            <InfoItem label="客户" value={detail.customer?.name} />
            <InfoItem
              label="来源送货单"
              value={
                detail.delivery ? (
                  <Link
                    href={`/sales/deliveries/${detail.delivery.id}`}
                    className="text-brand-600 hover:underline"
                  >
                    {detail.delivery.code}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            <InfoItem label="开票日期" value={formatDate(detail.invoiceDate)} />
            <InfoItem label="到期日" value={formatDate(detail.dueDate)} />
            <InfoItem label="币种" value={detail.currency} />
            <InfoItem label="含税合计" value={formatMoney(detail.invoiceTotal, detail.currency)} />
            <InfoItem label="已收款" value={formatMoney(detail.paidAmount, detail.currency)} />
            <InfoItem label="应收余额" value={formatMoney(detail.balanceAmount, detail.currency)} />
            <InfoItem label="备注" value={detail.remark} />
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
          </div>
        }
      >
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">
            明细行（{detail.lines?.length ?? 0}）
          </h2>
          <div className="overflow-x-auto">
            <table className="divide-border min-w-full divide-y text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium text-ink-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">行号</th>
                  <th className="px-3 py-2 font-medium">物料</th>
                  <th className="px-3 py-2 font-medium">描述</th>
                  <th className="px-3 py-2 font-medium">数量</th>
                  <th className="px-3 py-2 font-medium">单价</th>
                  <th className="px-3 py-2 font-medium">金额</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {(detail.lines ?? []).map((line) => (
                  <tr key={line.id}>
                    <td className="px-3 py-2 text-ink-secondary">{line.lineNo}</td>
                    <td className="px-3 py-2 text-ink-primary">
                      {line.item ? `${line.item.code ?? ""} ${line.item.name ?? ""}`.trim() : "—"}
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{line.description}</td>
                    <td className="px-3 py-2 text-ink-primary">{line.quantity}</td>
                    <td className="px-3 py-2 text-ink-secondary">
                      {formatMoney(line.unitPrice, detail.currency)}
                    </td>
                    <td className="px-3 py-2 text-ink-primary">
                      {formatMoney(
                        String(Number(line.quantity) * Number(line.unitPrice || 0)),
                        detail.currency,
                      )}
                    </td>
                  </tr>
                ))}
                {(detail.lines ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-sm text-ink-muted">
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
    <PermissionGuard permission={actionPermission("invoice", "view")}>
      <InvoiceDetailPage />
    </PermissionGuard>
  );
}
