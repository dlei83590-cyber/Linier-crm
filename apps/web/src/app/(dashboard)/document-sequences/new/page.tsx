"use client";

/** Document Sequences — 新建单据序列（Pending Pages Completion Gate — Batch 1；nextNo 由系统管理） */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";

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

const inputClass = INPUT_CLASS;


function DocumentSequenceCreateForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [docType, setDocType] = useState("");
  const [prefix, setPrefix] = useState("");
  const [padLength, setPadLength] = useState("4");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  const handleSave = () => {
    if (submitting) return;
    if (!code.trim() || !name.trim() || !docType) {
      setError(new ApiClientError(400, "编码、名称与单据类型为必填项", "VALIDATION"));
      return;
    }
    setSubmitting(true);
    setError(null);
    const payload: Record<string, unknown> = {
      code: code.trim(),
      name: name.trim(),
      docType,
      prefix: prefix.trim() || undefined,
      padLength: Number(padLength) || 4,
    };
    apiFetch<{ id: string }>("/api/document-sequences", {
      method: "POST",
      body: JSON.stringify(payload),
    })
      .then(() => router.push("/document-sequences"))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  return (
    <EntityFormWorkspace
      title="新建单据序列"
      description="维护单据编号序列规则（编号由系统引擎管理，当前序号不可手改）"
      backHref="/document-sequences"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSave}
      onCancel={() => router.push("/document-sequences")}
    >
      <section className="rounded-md border border-border p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="编码" required>
            <input value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} placeholder="如 SO/PO/QUO" />
          </FormField>
          <FormField label="名称" required>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </FormField>
          <FormField label="单据类型" required>
            <select value={docType} onChange={(e) => setDocType(e.target.value)} className={inputClass}>
              <option value="">请选择</option>
              {DOC_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="前缀">
            <input value={prefix} onChange={(e) => setPrefix(e.target.value)} className={inputClass} placeholder="如 SO-" />
          </FormField>
          <FormField label="序号位数">
            <input type="number" min={1} max={12} value={padLength} onChange={(e) => setPadLength(e.target.value)} className={inputClass} />
          </FormField>
        </div>
      </section>
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("document-sequence", "create")}>
      <AppPage>
        <DocumentSequenceCreateForm />
      </AppPage>
    </PermissionGuard>
  );
}