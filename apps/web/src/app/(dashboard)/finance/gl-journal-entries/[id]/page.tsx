"use client";

/** GL 记账凭证 — 详情页（Sprint 7 Finance 首块，ADR-0033；只读，含借贷行与科目） */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { formatDate, formatMoney } from "@/lib/format";

interface GlLine {
  id: string;
  debit: string;
  credit: string;
  summary: string | null;
  account?: { id: string; code: string; name: string; category: string; direction: string } | null;
}
interface GlEntryDetail {
  id: string;
  voucherNo: string;
  postingDate: string;
  status: string;
  sourceType: string;
  sourceId: string;
  summary: string | null;
  createdAt: string;
  lines: GlLine[];
}

const SOURCE_LABELS: Record<string, string> = {
  SupplierInvoicePosted: "发票过账",
  SupplierPaymentApplied: "付款核销",
  SupplierCreditDebitNoteApplied: "贷/借项应用",
  SupplierPaymentReversed: "付款冲销",
};
const CATEGORY_LABELS: Record<string, string> = { ASSET: "资产", LIABILITY: "负债", EQUITY: "权益", REVENUE: "收入", EXPENSE: "费用" };

function GlEntryDetailView() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [detail, setDetail] = useState<GlEntryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    apiFetch<GlEntryDetail>(`/api/gl/journal-entries/${id}`)
      .then((body) => { setDetail(body.data); setLoading(false); })
      .catch((err: unknown) => { setLoadError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR")); setLoading(false); });
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  if (loading) return (<AppPage><p className="px-4 py-6 text-sm text-ink-secondary">加载中…</p></AppPage>);
  if (loadError || !detail) return (<AppPage><ErrorPanel error={loadError ?? new ApiClientError(500, "加载失败", "LOAD_ERROR")} onRetry={load} /></AppPage>);

  return (
    <AppPage>
      <EntityFormWorkspace
        title={`记账凭证 ${detail.voucherNo}`}
        description={`来源：${SOURCE_LABELS[detail.sourceType] ?? detail.sourceType} ｜ 过账日期：${formatDate(detail.postingDate)} ｜ 状态：已过账（终态不可变）`}
        backHref="/finance/gl-journal-entries"
        mode="edit"
        submitting={false}
        error={null}
        dirty={false}
        saveLabel={undefined}
        onSave={() => undefined}
        onCancel={() => router.push("/finance/gl-journal-entries")}
      >
        <section className="rounded-md border border-border p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div><span className="text-sm text-ink-secondary">摘要</span><div className="text-sm font-medium">{detail.summary ?? "—"}</div></div>
            <div><span className="text-sm text-ink-secondary">来源业务</span><div className="text-sm font-medium">{detail.sourceType}（{detail.sourceId}）</div></div>
            <div><span className="text-sm text-ink-secondary">创建时间</span><div className="text-sm font-medium">{formatDate(detail.createdAt)}</div></div>
          </div>
        </section>
        <section className="rounded-md border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink-primary">凭证行（借贷平衡）</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="text-left text-xs font-medium text-ink-secondary"><tr><th className="px-3 py-2">科目</th><th className="px-3 py-2">类别</th><th className="px-3 py-2">摘要</th><th className="px-3 py-2 text-right">借方</th><th className="px-3 py-2 text-right">贷方</th></tr></thead>
              <tbody className="divide-y divide-border">
                {detail.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2">{l.account?.code} {l.account?.name}</td>
                    <td className="px-3 py-2">{CATEGORY_LABELS[l.account?.category ?? ""] ?? l.account?.category ?? "—"}</td>
                    <td className="px-3 py-2">{l.summary ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{Number(l.debit) > 0 ? formatMoney(l.debit, "CNY") : "—"}</td>
                    <td className="px-3 py-2 text-right">{Number(l.credit) > 0 ? formatMoney(l.credit, "CNY") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </EntityFormWorkspace>
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("gl", "view")}>
      <GlEntryDetailView />
    </PermissionGuard>
  );
}