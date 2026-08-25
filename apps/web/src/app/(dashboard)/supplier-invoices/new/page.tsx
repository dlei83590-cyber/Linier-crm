"use client";

/**
 * Supplier Invoice Create — 新建供应商发票（F2-6B 批 3，F2-6 开放）
 *
 * 契约：POST /api/supplier-invoices（supplier-invoice:create），创建即取号 SINV，初始 DRAFT。
 * RECEIPT_BASED：每行双溯源 purchaseOrderLineId + warehouseReceiptLineId（必须来自 POSTED 入库行），
 * 金额/税额由服务端 Decimal 计算（前端只传 quantity/unitPrice/taxRate，不传金额）。
 * PermissionGuard 对齐 API requirePermission("supplier-invoice:create")。
 *
 * FE2.0 UI-10：迁移到 EntityFormWorkspace（PageHeader + Section 分组 + INPUT_CLASS；Dirty-State
 * 离开保护由 EntityFormWorkspace 统一提供，消除手写 window.confirm）。
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";
import { INVOICE_TYPE_OPTIONS, validateIssueVatFields } from "@/lib/vat-labels";

interface SupplierOption {
  id: string;
  code: string | null;
  name: string | null;
}

interface LineForm {
  purchaseOrderLineId: string;
  warehouseReceiptLineId: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  vatRecoverable: boolean;
}

/** 本地今日 YYYY-MM-DD（date 输入默认值；用户指令 2026-08-21：全站日期默认今天） */
function todayInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const EMPTY_LINE: LineForm = {
  purchaseOrderLineId: "",
  warehouseReceiptLineId: "",
  quantity: "",
  unitPrice: "",
  taxRate: "13",
  vatRecoverable: true,
};

const inputClass = INPUT_CLASS;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink-primary">{title}</h2>
      {children}
    </section>
  );
}

function SupplierInvoiceCreateForm() {
  const router = useRouter();
  const toast = useToast();
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayInput);
  const [receivedDate, setReceivedDate] = useState(todayInput);
  // 单币种 CNY 固定（表单无币种/汇率输入；setter 不暴露避免 lint unused）
  const [currency] = useState("CNY");
  const [exchangeRate] = useState("1");
  const [paymentDueDate, setPaymentDueDate] = useState(todayInput);
  const [remark, setRemark] = useState("");
  // VAT 要素（ADR-0043）：进项发票类型（默认普票）+ 税务号码
  const [invoiceType, setInvoiceType] = useState("ORDINARY_VAT");
  const [taxInvoiceCode, setTaxInvoiceCode] = useState("");
  const [taxInvoiceNo, setTaxInvoiceNo] = useState("");
  const [lines, setLines] = useState<LineForm[]>([{ ...EMPTY_LINE }]);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<SupplierOption[]>("/api/suppliers?pageSize=100", { signal: controller.signal })
      .then((body) => setSuppliers(body.data))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof ApiClientError ? err : new ApiClientError(0, "加载供应商失败", "NETWORK_ERROR"),
        );
      });
    return () => controller.abort();
  }, []);

  const markDirty = () => setDirty(true);

  const updateLine = (idx: number, patch: Partial<LineForm>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    markDirty();
  };

  const addLine = () => {
    setLines((prev) => [...prev, { ...EMPTY_LINE }]);
    markDirty();
  };

  const removeLine = (idx: number) => {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
    markDirty();
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!supplierId) errs.supplierId = "请选择供应商";
    if (!supplierInvoiceNo.trim()) errs.supplierInvoiceNo = "请填写供应商发票号";
    if (!invoiceDate) errs.invoiceDate = "请选择开票日期";
    if (!receivedDate) errs.receivedDate = "请选择收到日期";
    const vatErr = validateIssueVatFields(invoiceType, taxInvoiceCode, taxInvoiceNo);
    if (vatErr) errs.vat = vatErr;
    lines.forEach((l, i) => {
      if (!l.purchaseOrderLineId.trim()) errs[`lines.${i}.po`] = "缺 PO 行 ID";
      if (!l.warehouseReceiptLineId.trim()) errs[`lines.${i}.whr`] = "缺入库行 ID";
      if (!l.quantity || Number(l.quantity) <= 0) errs[`lines.${i}.quantity`] = "数量必须大于 0";
      if (!l.unitPrice || Number(l.unitPrice) <= 0) errs[`lines.${i}.unitPrice`] = "单价必须大于 0";
    });
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        supplierId,
        supplierInvoiceNo: supplierInvoiceNo.trim(),
        invoiceDate,
        receivedDate,
        currency,
        exchangeRate: Number(exchangeRate) || 1,
        ...(paymentDueDate ? { paymentDueDate } : {}),
        ...(remark.trim() ? { remark: remark.trim() } : {}),
        ...(invoiceType ? { invoiceType } : {}),
        ...(taxInvoiceCode.trim() ? { taxInvoiceCode: taxInvoiceCode.trim() } : {}),
        ...(taxInvoiceNo.trim() ? { taxInvoiceNo: taxInvoiceNo.trim() } : {}),
        lines: lines.map((l) => ({
          purchaseOrderLineId: l.purchaseOrderLineId.trim(),
          warehouseReceiptLineId: l.warehouseReceiptLineId.trim(),
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          taxRate: Number(l.taxRate),
          vatRecoverable: l.vatRecoverable,
        })),
      };
      const body = await apiFetch<{ invoice: { id: string } }>("/api/supplier-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setDirty(false);
      toast.success("供应商发票已创建");
      router.push(`/supplier-invoices/${body.data.invoice.id}`);
    } catch (err: unknown) {
      setError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "创建失败", "NETWORK_ERROR"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppPage>
      <EntityFormWorkspace
        title="新建供应商发票"
        description="创建即取号（SINV）并进入 DRAFT；发票行双溯源 PO 行 + 已过账入库行，金额/税额由服务端计算"
        backHref="/supplier-invoices"
        mode="create"
        submitting={submitting}
        error={error}
        dirty={dirty}
        onDirty={() => setDirty(true)}
        onSave={handleSubmit}
        onCancel={() => router.push("/supplier-invoices")}
      >
        <Section title="发票信息">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField label="供应商" required>
              <select
                value={supplierId}
                onChange={(e) => {
                  setSupplierId(e.target.value);
                  markDirty();
                }}
                className={inputClass}
              >
                <option value="">选择供应商</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code ?? ""} {s.name ?? ""}
                  </option>
                ))}
              </select>
              {fieldErrors.supplierId ? (
                <p className="text-status-danger-text mt-0.5 text-xs">{fieldErrors.supplierId}</p>
              ) : null}
            </FormField>
            <FormField label="供应商发票号" required hint="≤100 字">
              <input
                value={supplierInvoiceNo}
                onChange={(e) => {
                  setSupplierInvoiceNo(e.target.value);
                  markDirty();
                }}
                maxLength={100}
                className={inputClass}
              />
              {fieldErrors.supplierInvoiceNo ? (
                <p className="text-status-danger-text mt-0.5 text-xs">{fieldErrors.supplierInvoiceNo}</p>
              ) : null}
            </FormField>
            <FormField label="开票日期" required>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => {
                  setInvoiceDate(e.target.value);
                  markDirty();
                }}
                className={inputClass}
              />
              {fieldErrors.invoiceDate ? (
                <p className="text-status-danger-text mt-0.5 text-xs">{fieldErrors.invoiceDate}</p>
              ) : null}
            </FormField>
            <FormField label="收到日期" required>
              <input
                type="date"
                value={receivedDate}
                onChange={(e) => {
                  setReceivedDate(e.target.value);
                  markDirty();
                }}
                className={inputClass}
              />
              {fieldErrors.receivedDate ? (
                <p className="text-status-danger-text mt-0.5 text-xs">{fieldErrors.receivedDate}</p>
              ) : null}
            </FormField>
            <FormField label="进项发票类型" required>
              <select
                value={invoiceType}
                onChange={(e) => {
                  setInvoiceType(e.target.value);
                  setTaxInvoiceCode("");
                  setTaxInvoiceNo("");
                  markDirty();
                }}
                className={inputClass}
              >
                {INVOICE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <span className="text-ink-muted text-xs">
                {invoiceType === "ELECTRONIC_VAT" ? "数电票：20 位号码，无代码" : "专票/普票：12 位代码 + 8 位号码"}
              </span>
              {fieldErrors.vat ? (
                <p className="text-status-danger-text mt-0.5 text-xs">{fieldErrors.vat}</p>
              ) : null}
            </FormField>
            {invoiceType !== "EXPORT" && invoiceType !== "OTHER" ? (
              invoiceType !== "ELECTRONIC_VAT" ? (
                <FormField label="发票代码（12 位）">
                  <input
                    value={taxInvoiceCode}
                    onChange={(e) => {
                      setTaxInvoiceCode(e.target.value.replace(/\D/g, ""));
                      markDirty();
                    }}
                    maxLength={12}
                    placeholder="12 位数字"
                    className={inputClass}
                  />
                </FormField>
              ) : null
            ) : null}
            {invoiceType !== "EXPORT" && invoiceType !== "OTHER" ? (
              <FormField label={"发票号码（" + (invoiceType === "ELECTRONIC_VAT" ? "20 位" : "8 位") + "）"}>
                <input
                  value={taxInvoiceNo}
                  onChange={(e) => {
                    setTaxInvoiceNo(e.target.value.replace(/\D/g, ""));
                    markDirty();
                  }}
                  maxLength={invoiceType === "ELECTRONIC_VAT" ? 20 : 8}
                  placeholder={invoiceType === "ELECTRONIC_VAT" ? "20 位数字" : "8 位数字"}
                  className={inputClass}
                />
              </FormField>
            ) : null}
            {/* 单币种 CNY（ADR：中国市场单币种决策）——币种/汇率固定，不提供输入，避免汇率空值/0 导致金额口径漂移 */}
            <FormField label="账期（可选）">
              <input
                type="date"
                value={paymentDueDate}
                onChange={(e) => {
                  setPaymentDueDate(e.target.value);
                  markDirty();
                }}
                className={inputClass}
              />
            </FormField>
            <FormField label="备注（可选）" hint="≤500 字">
              <input
                value={remark}
                onChange={(e) => {
                  setRemark(e.target.value);
                  markDirty();
                }}
                maxLength={500}
                className={inputClass}
              />
            </FormField>
          </div>
        </Section>

        <Section title="发票行（至少一行；双溯源 PO 行 + 已过账入库行）">
          <div className="mb-3 flex items-center justify-end">
            <button
              type="button"
              onClick={addLine}
              className="bg-brand-600 hover:bg-brand-700 rounded-md px-3 py-1.5 text-sm font-medium text-white"
            >
              + 添加行
            </button>
          </div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="divide-border min-w-full divide-y text-sm">
              <thead className="bg-canvas text-ink-secondary sticky top-0 z-10 text-left text-xs font-medium">
                <tr>
                  <th className="px-3 py-2 font-semibold">PO 行 ID</th>
                  <th className="px-3 py-2 font-semibold">入库行 ID</th>
                  <th className="px-3 py-2 font-semibold">数量</th>
                  <th className="px-3 py-2 font-semibold">单价</th>
                  <th className="px-3 py-2 font-semibold">税率%</th>
                  <th className="px-3 py-2 font-semibold">可抵扣</th>
                  <th className="px-3 py-2 font-semibold"></th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {lines.map((line, idx) => (
                  <tr key={idx}>
                    <td className="px-2 py-2">
                      <input
                        value={line.purchaseOrderLineId}
                        onChange={(e) => updateLine(idx, { purchaseOrderLineId: e.target.value })}
                        className={"w-full min-w-32 " + inputClass}
                      />
                      {fieldErrors["lines." + idx + ".po"] ? (
                        <p className="text-status-danger-text mt-0.5 text-xs">{fieldErrors["lines." + idx + ".po"]}</p>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      <input
                        value={line.warehouseReceiptLineId}
                        onChange={(e) => updateLine(idx, { warehouseReceiptLineId: e.target.value })}
                        className={"w-full min-w-32 " + inputClass}
                      />
                      {fieldErrors["lines." + idx + ".whr"] ? (
                        <p className="text-status-danger-text mt-0.5 text-xs">{fieldErrors["lines." + idx + ".whr"]}</p>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={line.quantity}
                        onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                        className={"w-24 " + inputClass}
                      />
                      {fieldErrors["lines." + idx + ".quantity"] ? (
                        <p className="text-status-danger-text mt-0.5 text-xs">{fieldErrors["lines." + idx + ".quantity"]}</p>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={line.unitPrice}
                        onChange={(e) => updateLine(idx, { unitPrice: e.target.value })}
                        className={"w-24 " + inputClass}
                      />
                      {fieldErrors["lines." + idx + ".unitPrice"] ? (
                        <p className="text-status-danger-text mt-0.5 text-xs">{fieldErrors["lines." + idx + ".unitPrice"]}</p>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="any"
                        value={line.taxRate}
                        onChange={(e) => updateLine(idx, { taxRate: e.target.value })}
                        className={"w-20 " + inputClass}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={line.vatRecoverable}
                        onChange={(e) => updateLine(idx, { vatRecoverable: e.target.checked })}
                        className="h-4 w-4 accent-brand-600"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        disabled={lines.length <= 1}
                        className="border-border text-ink-secondary hover:bg-canvas rounded-md border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {Object.keys(fieldErrors).length > 0 ? (
            <p className="text-status-danger-text mt-2 text-xs">
              {Object.values(fieldErrors).filter(Boolean)[0] ?? ""}
            </p>
          ) : null}
        </Section>
      </EntityFormWorkspace>
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("supplier-invoice", "create")}>
      <SupplierInvoiceCreateForm />
    </PermissionGuard>
  );
}
