"use client";

/** Supplier CN/DN — 贷/借项详情页（5C-2；状态机按钮：DRAFT→submit、APPROVED→apply，消费后端状态契约） */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace, StatusBadge, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { formatDate, formatMoney } from "@/lib/format";

interface CnDnDetail {
  id: string;
  code: string;
  noteType: string;
  currency: string;
  adjustmentTotal: string;
  status: string;
  reason: string;
  version: number;
  createdAt: string;
  supplier?: { id: string; code: string; name: string } | null;
  sourceSupplierInvoice?: { invoiceNo: string; documentStatus: string } | null;
  invoices?: Array<{ supplierInvoice?: { invoiceNo: string; documentStatus: string } | null }> | null;
  lines: Array<{ id: string; lineNo: number; description: string; quantity: string; unitPrice: string; amount: string; item?: { id: string; code: string; name: string } | null }>;
}

const TYPE_LABELS: Record<string, string> = { CREDIT: "贷项（冲减应付）", DEBIT: "借项（增加应付）" };
const STATUS_LABELS: Record<string, string> = { DRAFT: "草稿", SUBMITTED: "已提交", APPROVED: "已批准", APPLIED: "已应用", CANCELLED: "已取消" };
const STATUS_TONE_MAP: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { DRAFT: "neutral", SUBMITTED: "info", APPROVED: "success", APPLIED: "success", CANCELLED: "danger" };

function CnDnDetailView() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [detail, setDetail] = useState<CnDnDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<ApiClientError | null>(null);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    apiFetch<CnDnDetail>(`/api/supplier-credit-debit-notes/${id}`)
      .then((body) => { setDetail(body.data); setLoading(false); })
      .catch((err: unknown) => { setLoadError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR")); setLoading(false); });
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const runAction = (action: "submit" | "apply") => {
    if (!detail || acting) return;
    setActing(true);
    setActionError(null);
    apiFetch<{ id: string }>(`/api/supplier-credit-debit-notes/${id}/${action}`, {
      method: "POST",
      body: JSON.stringify({ version: detail.version }),
    })
      .then(() => load())
      .catch((err: unknown) => {
        setActionError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setActing(false);
      });
  };

  if (loading) return (<AppPage><p className="px-4 py-6 text-sm text-ink-secondary">加载中…</p></AppPage>);
  if (loadError || !detail) return (<AppPage><ErrorPanel error={loadError ?? new ApiClientError(500, "加载失败", "LOAD_ERROR")} onRetry={load} /></AppPage>);

  const canSubmit = detail.status === "DRAFT";
  const canApply = detail.status === "APPROVED";

  return (
    <AppPage>
      <EntityFormWorkspace
        title={`供应商${detail.noteType === "CREDIT" ? "贷项" : "借项"}通知单`}
        description={`单据号：${detail.code} ｜ 类型：${TYPE_LABELS[detail.noteType] ?? detail.noteType} ｜ 状态：${STATUS_LABELS[detail.status] ?? detail.status}`}
        backHref="/supplier-ap/credit-debit-notes"
        mode="edit"
        submitting={acting}
        error={actionError}
        dirty={false}
        saveLabel={canApply ? "应用（APPLIED）" : canSubmit ? "提交（SUBMITTED）" : undefined}
        onSave={() => { if (canApply) runAction("apply"); else if (canSubmit) runAction("submit"); }}
        onCancel={() => router.push("/supplier-ap/credit-debit-notes")}
      >
        <section className="rounded-md border border-border p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div><span className="text-sm text-ink-secondary">供应商</span><div className="text-sm font-medium">{detail.supplier?.name ?? "—"}</div></div>
            <div><span className="text-sm text-ink-secondary">来源发票</span><div className="text-sm font-medium">{detail.invoices && detail.invoices.length > 0 ? detail.invoices.map((i) => i.supplierInvoice?.invoiceNo ?? "—").join("、") : detail.sourceSupplierInvoice?.invoiceNo ?? "—"}</div></div>
            <div><span className="text-sm text-ink-secondary">调整金额</span><div className="text-sm font-medium">{formatMoney(detail.adjustmentTotal, detail.currency)}</div></div>
            <div><span className="text-sm text-ink-secondary">币种</span><div className="text-sm font-medium">{detail.currency}</div></div>
            <div><span className="text-sm text-ink-secondary">状态</span><div><StatusBadge status={detail.status} label={STATUS_LABELS[detail.status] ?? detail.status} toneMap={STATUS_TONE_MAP} /></div></div>
            <div><span className="text-sm text-ink-secondary">创建时间</span><div className="text-sm font-medium">{formatDate(detail.createdAt)}</div></div>
            <div className="md:col-span-3"><span className="text-sm text-ink-secondary">调整原因</span><div className="text-sm font-medium">{detail.reason}</div></div>
          </div>
        </section>
        <section className="rounded-md border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink-primary">调整明细</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="text-left text-xs font-medium text-ink-secondary"><tr><th className="px-3 py-2">物料</th><th className="px-3 py-2">描述</th><th className="px-3 py-2">数量</th><th className="px-3 py-2">单价快照</th><th className="px-3 py-2">金额</th></tr></thead>
              <tbody className="divide-y divide-border">
                {detail.lines.map((l) => (<tr key={l.id}><td className="px-3 py-2">{l.item?.name ?? "—"}</td><td className="px-3 py-2">{l.description}</td><td className="px-3 py-2">{l.quantity}</td><td className="px-3 py-2">{l.unitPrice}</td><td className="px-3 py-2">{l.amount}</td></tr>))}
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
    <PermissionGuard permission={actionPermission("supplier-credit-debit-note", "view")}>
      <CnDnDetailView />
    </PermissionGuard>
  );
}