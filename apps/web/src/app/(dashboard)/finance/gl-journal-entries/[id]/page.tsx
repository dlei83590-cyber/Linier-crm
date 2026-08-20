"use client";

/** GL 记账凭证 — 详情页（Sprint 7 Finance 首块，ADR-0033；只读，含借贷行与科目） */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { PageLoading } from "@/components/ui/skeleton";
import { formatDate, formatMoney } from "@/lib/format";
import { VOUCHER_TYPE_LABELS } from "@/lib/vat-labels";

interface GlLine {
  id: string;
  debit: string;
  credit: string;
  summary: string | null;
  account?: { id: string; code: string; name: string; category: string; direction: string } | null;
}
interface GlEntryDetail {
  id: string;
  voucherNo: string | null;
  postingDate: string;
  status: string;
  sourceType: string;
  sourceId: string;
  summary: string | null;
  voucherType?: string | null;
  attachmentCount?: number | null;
  version: number;
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
const STATUS_LABELS: Record<string, string> = { DRAFT: "草稿", SUBMITTED: "已提交", APPROVED: "已批准", POSTED: "已过账", REJECTED: "已驳回" };

function GlEntryDetailView() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const toast = useToast();
  const id = params.id;
  const [detail, setDetail] = useState<GlEntryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<ApiClientError | null>(null);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    apiFetch<GlEntryDetail>(`/api/gl/journal-entries/${id}`)
      .then((body) => { setDetail(body.data); setLoading(false); })
      .catch((err: unknown) => { setLoadError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR")); setLoading(false); });
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const runAction = (action: "submit" | "approve" | "post" | "reject") => {
    if (!detail || acting) return;
    setActing(true);
    setActionError(null);
    apiFetch<{ id: string }>(`/api/gl/journal-entries/${detail.id}/${action}`, {
      method: "POST",
      body: JSON.stringify({ version: detail.version }),
    })
      .then(() => {
        const ACTION_LABEL: Record<string, string> = { submit: "提交", approve: "批准", post: "过账", reject: "驳回" };
        toast.success(`${ACTION_LABEL[action] ?? action}成功`);
        load();
      })
      .catch((err: unknown) => {
        toast.error("操作失败", err instanceof ApiClientError ? err.message : "网络错误");
        setActionError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setActing(false);
      });
  };

  if (loading) return (<AppPage><div className="border-border bg-surface overflow-hidden rounded-lg border"><PageLoading rows={5} /></div></AppPage>);
  if (loadError || !detail) return (<AppPage><ErrorPanel error={loadError ?? new ApiClientError(500, "加载失败", "LOAD_ERROR")} onRetry={load} /></AppPage>);

  return (
    <AppPage>
      <EntityFormWorkspace
        title={`记账凭证 ${detail.voucherNo ?? "（未取号）"}`}
        description={`来源：${SOURCE_LABELS[detail.sourceType] ?? (detail.sourceType === "MANUAL" ? "手工录入" : detail.sourceType)} ｜ 过账日期：${formatDate(detail.postingDate)} ｜ 状态：${STATUS_LABELS[detail.status] ?? detail.status} ｜ 凭证号：${detail.voucherNo ?? "（未取号）"} ｜ 凭证字：${VOUCHER_TYPE_LABELS[detail.voucherType ?? "GENERAL"] ?? "记"} ｜ 附件：${detail.attachmentCount ?? 0} 张`}
        backHref="/finance/gl-journal-entries"
        mode="edit"
        submitting={acting}
        error={actionError}
        dirty={false}
        saveLabel={detail.sourceType === "MANUAL" && detail.status === "DRAFT" ? "提交（SUBMITTED）" : detail.sourceType === "MANUAL" && detail.status === "SUBMITTED" ? "审核通过（APPROVED）" : detail.sourceType === "MANUAL" && detail.status === "APPROVED" ? "过账（POSTED）" : undefined}
        onSave={() => {
          if (detail.sourceType !== "MANUAL") return;
          if (detail.status === "DRAFT") runAction("submit");
          else if (detail.status === "SUBMITTED") runAction("approve");
          else if (detail.status === "APPROVED") runAction("post");
        }}
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