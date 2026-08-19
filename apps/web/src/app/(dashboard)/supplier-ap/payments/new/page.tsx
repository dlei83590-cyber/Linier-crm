"use client";

/** Supplier Payments — 新建付款单（5C-2；code 创建即取号；金额为付款事实） */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";

interface SupplierOption { id: string; code: string; name: string; }

const inputClass = "w-full rounded-md border border-border px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted focus:border-brand-500 focus:outline-none";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-ink-secondary">{label}{required ? <span className="ml-0.5 text-status-danger-text">*</span> : null}</span>
      {children}
    </label>
  );
}

const METHOD_OPTIONS = [
  { value: "BANK_TRANSFER", label: "银行转账" },
  { value: "CHEQUE", label: "支票" },
  { value: "CASH", label: "现金" },
  { value: "CARD", label: "刷卡" },
  { value: "OTHER", label: "其他" },
];

function PaymentCreateForm() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [currency, setCurrency] = useState("CNY");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState("BANK_TRANSFER");
  const [referenceNo, setReferenceNo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<SupplierOption[]>("/api/suppliers?pageSize=100", { signal: controller.signal })
      .then((body) => setSuppliers(body.data))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const handleSave = () => {
    if (submitting) return;
    if (!supplierId || !amount || Number(amount) <= 0 || !paymentDate) {
      setError(new ApiClientError(400, "供应商、金额与付款日期为必填项", "VALIDATION"));
      return;
    }
    setSubmitting(true);
    setError(null);
    apiFetch<{ id: string }>("/api/supplier-payments", {
      method: "POST",
      body: JSON.stringify({
        supplierId,
        currency: currency || undefined,
        amount: Number(amount),
        paymentDate: new Date(paymentDate).toISOString(),
        paymentMethod,
        referenceNo: referenceNo.trim() || undefined,
      }),
    })
      .then((body) => router.push(`/supplier-ap/payments/${body.data.id}`))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  return (
    <EntityFormWorkspace
      title="新建付款单"
      description="付款单号由系统取号（PAY）；创建后可进入详情核销应付未结项"
      backHref="/supplier-ap/payments"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSave}
      onCancel={() => router.push("/supplier-ap/payments")}
    >
      <section className="rounded-md border border-border p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="供应商" required>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputClass}>
              <option value="">请选择</option>
              {suppliers.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
          </Field>
          <Field label="币种">
            <input value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass} />
          </Field>
          <Field label="付款金额" required>
            <input type="number" min={0.01} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
          </Field>
          <Field label="付款日期" required>
            <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className={inputClass} />
          </Field>
          <Field label="付款方式" required>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inputClass}>
              {METHOD_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </select>
          </Field>
          <Field label="银行流水号/备注">
            <input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} className={inputClass} />
          </Field>
        </div>
      </section>
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("supplier-payment", "create")}>
      <AppPage><PaymentCreateForm /></AppPage>
    </PermissionGuard>
  );
}