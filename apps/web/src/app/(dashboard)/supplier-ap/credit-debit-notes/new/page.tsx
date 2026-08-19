"use client";

/** Supplier CN/DN — 新建贷/借项（5C-2 跨票 Consolidated：可关联多张同供应商同币种 POSTED 发票；金额服务端计算） */
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
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [invoiceLines, setInvoiceLines] = useState<Record<string, InvoiceDetail["lines"]>>({});
  const [lineOwner, setLineOwner] = useState<Record<string, string>>({}); // lineId -> invoiceId（行归属）
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

  const toggleInvoice = (id: string) => {
    setDirty(true);
    const isSelected = selectedInvoiceIds.includes(id);
    if (isSelected) {
      // 取消选中：移除该发票及其行归属/选中行
      setSelectedInvoiceIds((prev) => prev.filter((x) => x !== id));
      setSelectedLines((sel) => {
        const rest: Record<string, string> = {};
        for (const [lineId, qty] of Object.entries(sel)) {
          if (lineOwner[lineId] !== id) rest[lineId] = qty;
        }
        return rest;
      });
    } else {
      setSelectedInvoiceIds((prev) => [...prev, id]);
      apiFetch<InvoiceDetail>(`/api/supplier-invoices/${id}`)
        .then((body) => {
          setInvoiceLines((m) => ({ ...m, [id]: body.data.lines }));
          const owners: Record<string, string> = {};
          for (const l of body.data.lines) owners[l.id] = id;
          setLineOwner((prev) => ({ ...prev, ...owners }));
        })
        .catch(() => setInvoiceLines((m) => ({ ...m, [id]: [] })));
    }
  };

  const handleSave = () => {
    if (submitting) return;
    if (selectedInvoiceIds.length === 0 || !reason.trim()) {
      setError(new ApiClientError(400, "至少选择一张来源发票，且调整原因为必填项", "VALIDATION"));
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
      body: JSON.stringify({ noteType, sourceSupplierInvoiceIds: selectedInvoiceIds, reason: reason.trim(), lines }),
    })
      .then((body) => router.push(`/supplier-ap/credit-debit-notes/${body.data.id}`))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  const selectedInvoices = invoices.filter((inv) => selectedInvoiceIds.includes(inv.id));
  const hasMultipleSuppliers = new Set(selectedInvoices.map((i) => i.supplierId)).size > 1;

  return (
    <EntityFormWorkspace
      title="新建供应商贷/借项"
      description="来源供应商发票须已过账（POSTED）且同供应商同币种；调整金额由服务端按行计算并分摊到各发票"
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
          <div className="md:col-span-2">
            <Field label="来源发票（已过账，可多选跨票）" required>
              <div className="max-h-56 overflow-y-auto rounded-md border border-border">
                {invoices.map((inv) => (
                  <label key={inv.id} className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-1.5 text-sm last:border-b-0 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={selectedInvoiceIds.includes(inv.id)}
                      onChange={() => toggleInvoice(inv.id)}
                      className="h-4 w-4"
                    />
                    <span>{inv.invoiceNo}（{inv.supplier?.name ?? "—"}｜{inv.currency}）</span>
                  </label>
                ))}
                {invoices.length === 0 ? <div className="px-3 py-2 text-sm text-ink-muted">暂无已过账（POSTED）发票</div> : null}
              </div>
            </Field>
            {hasMultipleSuppliers ? (
              <p className="mt-1 text-xs text-status-danger-text">跨票调整要求全部发票同供应商同币种，请只选择同一供应商的发票</p>
            ) : null}
          </div>
          <div className="md:col-span-2">
            <Field label="调整原因" required>
              <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} placeholder="折扣/退货/价差/更正/其他" />
            </Field>
          </div>
        </div>
      </section>
      {selectedInvoiceIds.length > 0 && (
        <section className="rounded-md border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink-primary">调整明细行（数量 × 单价快照 = 金额，服务端计算并按发票分摊）</h2>
          {selectedInvoiceIds.map((invId) => {
            const inv = invoices.find((i) => i.id === invId);
            const lines = invoiceLines[invId] ?? [];
            return (
              <div key={invId} className="mb-4">
                <h3 className="mb-2 text-sm font-medium text-ink-secondary">{inv?.invoiceNo ?? invId}（{inv?.supplier?.name ?? "—"}）</h3>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="min-w-full divide-y divide-border text-sm">
                    <thead className="text-left text-xs font-medium text-ink-secondary"><tr><th className="px-3 py-2">选择</th><th className="px-3 py-2">物料</th><th className="px-3 py-2">单价快照</th><th className="px-3 py-2">调整数量</th></tr></thead>
                    <tbody className="divide-y divide-border">
                      {lines.map((l) => (
                        <tr key={l.id}>
                          <td className="px-3 py-2"><input type="checkbox" checked={!!selectedLines[l.id]} onChange={(e) => { const next = { ...selectedLines }; if (e.target.checked) next[l.id] = "1"; else delete next[l.id]; setSelectedLines(next); setDirty(true); }} /></td>
                          <td className="px-3 py-2">{l.item?.name ?? "—"}</td>
                          <td className="px-3 py-2">{l.unitPrice}</td>
                          <td className="px-3 py-2"><input type="number" min={0.0001} step="any" value={selectedLines[l.id] ?? ""} disabled={!selectedLines[l.id]} onChange={(e) => setSelectedLines((prev) => ({ ...prev, [l.id]: e.target.value }))} className={inputClass} /></td>
                        </tr>
                      ))}
                      {lines.length === 0 ? <tr><td colSpan={4} className="px-3 py-2 text-sm text-ink-muted">加载中…</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
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