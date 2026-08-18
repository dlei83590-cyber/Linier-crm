"use client";

/** Document Sequences — 编辑单据序列（Pending Pages Completion Gate — Batch 1；nextNo 只读，CAS version） */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";

interface DocumentSequenceDetail {
  id: string;
  code: string;
  name: string;
  docType: string;
  prefix: string | null;
  nextNo: number;
  padLength: number;
  isActive: boolean;
  version: number;
}

const DOC_TYPE_OPTIONS = [
  { value: "QUOTATION", label: "报价单" },
  { value: "SALES_ORDER", label: "销售订单" },
  { value: "PURCHASE_ORDER", label: "采购订单" },
  { value: "PURCHASE_REQUISITION", label: "采购申请" },
  { value: "PROFORMA_INVOICE", label: "形式发票" },
  { value: "COMMERCIAL_INVOICE", label: "商业发票" },
  { value: "DELIVERY_ORDER", label: "送货单" },
  { value: "GOODS_RECEIPT_NOTE", label: "收货单" },
  { value: "GOODS_ISSUE", label: "出库单" },
  { value: "INVOICE", label: "发票" },
  { value: "CREDIT_NOTE", label: "贷项通知单" },
  { value: "DEBIT_NOTE", label: "借项通知单" },
  { value: "PAYMENT_VOUCHER", label: "付款凭证" },
  { value: "RECEIPT", label: "收款收据" },
  { value: "WRITE_OFF", label: "坏账/折让" },
  { value: "EXPENSE", label: "费用报销" },
  { value: "JOURNAL", label: "日记账" },
  { value: "CONTRACT", label: "合同" },
  { value: "PROJECT", label: "项目" },
  { value: "PURCHASE_RECEIPT", label: "采购收货单" },
  { value: "WAREHOUSE_RECEIPT", label: "采购入库单" },
  { value: "PURCHASE_RETURN", label: "采购退货单" },
  { value: "INVENTORY_MOVEMENT", label: "库存流水" },
  { value: "INVENTORY_TRANSFER", label: "调拨单" },
  { value: "STOCK_COUNT", label: "盘点单" },
  { value: "INVENTORY_ADJUSTMENT", label: "库存调整单" },
  { value: "INVENTORY_CONVERSION", label: "库存转换单" },
  { value: "SUPPLIER_INVOICE", label: "供应商发票" },
];

const inputClass =
  "w-full rounded-md border border-border px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted focus:border-brand-500 focus:outline-none";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-ink-secondary">
        {label}
        {required ? <span className="ml-0.5 text-status-danger-text">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function DocumentSequenceEditForm() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [docType, setDocType] = useState("");
  const [prefix, setPrefix] = useState("");
  const [nextNo, setNextNo] = useState(1);
  const [padLength, setPadLength] = useState("4");
  const [isActive, setIsActive] = useState(true);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    apiFetch<DocumentSequenceDetail>(`/api/document-sequences/${id}`)
      .then((body) => {
        const d = body.data;
        setCode(d.code);
        setName(d.name);
        setDocType(d.docType);
        setPrefix(d.prefix ?? "");
        setNextNo(d.nextNo);
        setPadLength(String(d.padLength));
        setIsActive(d.isActive);
        setVersion(d.version);
        setDirty(false);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleSave = () => {
    if (submitting) return;
    if (!name.trim() || !docType) {
      setError(new ApiClientError(400, "名称与单据类型为必填项", "VALIDATION"));
      return;
    }
    setSubmitting(true);
    setError(null);
    const payload: Record<string, unknown> = {
      version,
      code: code.trim() || undefined,
      name: name.trim(),
      docType,
      prefix: prefix.trim() || null,
      padLength: Number(padLength) || 4,
      isActive,
    };
    apiFetch<{ id: string }>(`/api/document-sequences/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    })
      .then(() => router.push("/document-sequences"))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  if (loading) {
    return (
      <EntityFormWorkspace title="编辑单据序列" backHref="/document-sequences" mode="edit" submitting={false} onSave={handleSave} onCancel={() => router.push("/document-sequences")}>
        <p className="px-4 py-6 text-sm text-ink-secondary">加载中…</p>
      </EntityFormWorkspace>
    );
  }

  if (loadError) {
    return (
      <EntityFormWorkspace title="编辑单据序列" backHref="/document-sequences" mode="edit" submitting={false} error={loadError} onSave={handleSave} onCancel={() => router.push("/document-sequences")}>
        <p className="px-4 py-6 text-sm text-ink-secondary">加载失败</p>
      </EntityFormWorkspace>
    );
  }

  return (
    <EntityFormWorkspace
      title="编辑单据序列"
      description={`编码：${code}`}
      backHref="/document-sequences"
      mode="edit"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onReload={() => {
        load();
        setError(null);
      }}
      onSave={handleSave}
      onCancel={() => router.push("/document-sequences")}
    >
      <section className="rounded-md border border-border p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="编码" required>
            <input value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} />
          </Field>
          <Field label="名称" required>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </Field>
          <Field label="单据类型" required>
            <select value={docType} onChange={(e) => setDocType(e.target.value)} className={inputClass}>
              {DOC_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="前缀">
            <input value={prefix} onChange={(e) => setPrefix(e.target.value)} className={inputClass} />
          </Field>
          <Field label="序号位数">
            <input type="number" min={1} max={12} value={padLength} onChange={(e) => setPadLength(e.target.value)} className={inputClass} />
          </Field>
          <Field label="当前序号（系统管理，只读）">
            <input value={String(nextNo).padStart(Number(padLength) || 4, "0")} readOnly className={`${inputClass} bg-slate-50`} />
          </Field>
          <Field label="启用">
            <select value={isActive ? "true" : "false"} onChange={(e) => setIsActive(e.target.value === "true")} className={inputClass}>
              <option value="true">是</option>
              <option value="false">否</option>
            </select>
          </Field>
        </div>
      </section>
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("document-sequence", "edit")}>
      <AppPage>
        <DocumentSequenceEditForm />
      </AppPage>
    </PermissionGuard>
  );
}