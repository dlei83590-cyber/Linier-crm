"use client";

/** Supplier CN/DN — 新建贷/借项（5C-2；来源发票必须 POSTED；金额服务端计算） */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";

interface InvoiceOption {
  id: string;
  invoiceNo: string;
  supplierId: string;
  currency: string;
  supplier?: { id: string; name: string } | null;
}
interface InvoiceDetail {
  id: string;
  currency: string;
  lines: Array<{ id: string; lineNo: number; item?: { id: string; code: string; name: string } | null; quantity: string; unitPrice: string; netAmount: string }>;
}

const inputClass = "w-full rounded-md border border-border px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted focus:border-brand-500 focus:outline-none";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-ink-secondary">{label}{required ? <span className="ml-0.5 text-status-danger-text">*</span> : null}</span>
      {children}
    </label>
  );
}

function CnDnCreateForm() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [noteType, setNoteType] = useState("CREDIT");
  const [invoiceId, setInvoiceId] = useState("");
  const [invoiceLines, setInvoiceLines] = useState<InvoiceDetail["lines"]>([]);
  const [selectedLines, setSelectedLines] = useState<Record<string, string>>({}); // lineId -> quantity
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<InvoiceOption[]>("/api/supplier-invoices?pageSize=100&documentStatus=POSTED", { signal: controller.signal })
      .then((body) => setInvoices(body.data))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const loadInvoiceLines = (id: string) => {
    setInvoiceId(id);
    setSelectedLines({});
    apiFetch<InvoiceDetail>(`/api/supplier-invoices/${id}`)
      .then((body) => setInvoiceLines(body.data.lines))
      .catch(() => setInvoiceLines([]));
  };

  const handleSave = () => {
    if (submitting) return;
    if (!invoiceId || !reason.trim()) {
      setError(new ApiClientError(400, "来源发票与调整原因为必填项", "VALIDATION"));
      return;
    }
    const lines = Object.entries(selectedLines)
      .filter(([, qty]) => qty && Number(qty) > 0)
      .map(([lineId, qty]) => ({ sourceSupplierInvoiceLineId: lineId, quantity: Number(qty) }));
    if (lines.length === 0) {
      setError(new ApiClientError(400, "至少录入一行调整数量", "VALIDATION"));
      return;
    }
    setSubmitting(true);
    setError(null);
    apiFetch<{ id: string }>("/api/supplier-credit-debit-notes", {
      method: "POST",
      body: JSON.stringify({ noteType, sourceSupplierInvoiceId: invoiceId, reason: reason.trim(), lines }),
    })
      .then((body) => router.push(`/supplier-ap/credit-debit-notes/${body.data.id}`))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  return (
    <EntityFormWorkspace
      title="新建供应商贷/借项"
      description="来源供应商发票须已过账（POSTED）；调整金额由服务端按行计算"
      backHref="/supplier-ap/credit-debit-notes"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSave}
      onCancel={() => router.push("/supplier-ap/credit-debit-notes")}
    >
      <section className="rounded-md border border-border p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="类型" required>
            <select value={noteType} onChange={(e) => setNoteType(e.target.value)} className={inputClass}>
              <option value="CREDIT">贷项（冲减应付）</option>
              <option value="DEBIT">借项（增加应付）</option>
            </select>
          </Field>
          <Field label="来源发票（已过账）" required>
            <select value={invoiceId} onChange={(e) => loadInvoiceLines(e.target.value)} className={inputClass}>
              <option value="">请选择</option>
              {invoices.map((inv) => (<option key={inv.id} value={inv.id}>{inv.invoiceNo}（{inv.supplier?.name ?? "—"}）</option>))}
            </select>
          </Field>
          <div className="md:col-span-2">
            <Field label="调整原因" required>
              <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} placeholder="折扣/退货/价差/更正/其他" />
            </Field>
          </div>
        </div>
      </section>
      {invoiceId && (
        <section className="rounded-md border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink-primary">调整明细行（数量 × 单价快照 = 金额，服务端计算）</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="text-left text-xs font-medium text-ink-secondary"><tr><th className="px-3 py-2">选择</th><th className="px-3 py-2">物料</th><th className="px-3 py-2">单价快照</th><th className="px-3 py-2">调整数量</th></tr></thead>
              <tbody className="divide-y divide-border">
                {invoiceLines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2"><input type="checkbox" checked={!!selectedLines[l.id]} onChange={(e) => { const next = { ...selectedLines }; if (e.target.checked) next[l.id] = "1"; else delete next[l.id]; setSelectedLines(next); }} /></td>
                    <td className="px-3 py-2">{l.item?.name ?? "—"}</td>
                    <td className="px-3 py-2">{l.unitPrice}</td>
                    <td className="px-3 py-2"><input type="number" min={0.0001} step="any" value={selectedLines[l.id] ?? ""} disabled={!selectedLines[l.id]} onChange={(e) => setSelectedLines((prev) => ({ ...prev, [l.id]: e.target.value }))} className={inputClass} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("supplier-credit-debit-note", "create")}>
      <AppPage><CnDnCreateForm /></AppPage>
    </PermissionGuard>
  );
}