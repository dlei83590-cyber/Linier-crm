"use client";

/**
 * Supplier Invoice Create — 新建供应商发票（F2-6B 批 3，F2-6 开放）
 *
 * 契约：POST /api/supplier-invoices（supplier-invoice:create），创建即取号 SINV，初始 DRAFT。
 * RECEIPT_BASED：每行双溯源 purchaseOrderLineId + warehouseReceiptLineId（必须来自 POSTED 入库行），
 * 金额/税额由服务端 Decimal 计算（前端只传 quantity/unitPrice/taxRate，不传金额）。
 * PermissionGuard 对齐 API requirePermission("supplier-invoice:create")。
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { CARD_CLASS } from "@/lib/ui-classes";

interface SupplierOption { id: string; code: string | null; name: string | null }

interface LineForm {
  purchaseOrderLineId: string;
  warehouseReceiptLineId: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  vatRecoverable: boolean;
}

const EMPTY_LINE: LineForm = {
  purchaseOrderLineId: "",
  warehouseReceiptLineId: "",
  quantity: "",
  unitPrice: "",
  taxRate: "13",
  vatRecoverable: true,
};

function SupplierInvoiceCreateForm() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [receivedDate, setReceivedDate] = useState("");
  const [currency, setCurrency] = useState("CNY");
  const [exchangeRate, setExchangeRate] = useState("1");
  const [paymentDueDate, setPaymentDueDate] = useState("");
  const [remark, setRemark] = useState("");
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

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

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
    <div className={CARD_CLASS}>
      <div className="flex items-center justify-between border-b border-border p-4">
        <h1 className="text-lg font-semibold text-ink-primary">新建供应商发票</h1>
        <Link
          href="/supplier-invoices"
          onClick={(e) => {
            if (dirty && !window.confirm("有未保存的更改，确定离开？")) e.preventDefault();
          }}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-canvas"
        >
          返回列表
        </Link>
      </div>

      <div className="p-4">
        {error && (
          <div className="mb-4 rounded-md bg-status-danger-bg p-3 text-sm text-status-danger-text">
            <p>
              {describeStatus(error.status)}：{error.message}
              {error.code ? `（${error.code}）` : ""}
            </p>
          </div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-4 rounded-md bg-canvas p-4 text-sm md:grid-cols-3">
          <div>
            <label className="block text-xs text-ink-secondary">供应商 *</label>
            <select
              value={supplierId}
              onChange={(e) => { setSupplierId(e.target.value); markDirty(); }}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
            >
              <option value="">选择供应商</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.code ?? ""} {s.name ?? ""}</option>
              ))}
            </select>
            {fieldErrors.supplierId && <p className="mt-0.5 text-xs text-status-danger-text">{fieldErrors.supplierId}</p>}
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">供应商发票号 *（≤100）</label>
            <input
              value={supplierInvoiceNo}
              onChange={(e) => { setSupplierInvoiceNo(e.target.value); markDirty(); }}
              maxLength={100}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
            />
            {fieldErrors.supplierInvoiceNo && <p className="mt-0.5 text-xs text-status-danger-text">{fieldErrors.supplierInvoiceNo}</p>}
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">开票日期 *</label>
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => { setInvoiceDate(e.target.value); markDirty(); }}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
            />
            {fieldErrors.invoiceDate && <p className="mt-0.5 text-xs text-status-danger-text">{fieldErrors.invoiceDate}</p>}
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">收到日期 *</label>
            <input
              type="date"
              value={receivedDate}
              onChange={(e) => { setReceivedDate(e.target.value); markDirty(); }}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
            />
            {fieldErrors.receivedDate && <p className="mt-0.5 text-xs text-status-danger-text">{fieldErrors.receivedDate}</p>}
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">币种</label>
            <input value={currency} onChange={(e) => { setCurrency(e.target.value); markDirty(); }} maxLength={10} className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">汇率</label>
            <input type="number" min="0" step="any" value={exchangeRate} onChange={(e) => { setExchangeRate(e.target.value); markDirty(); }} className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">账期（可选）</label>
            <input type="date" value={paymentDueDate} onChange={(e) => { setPaymentDueDate(e.target.value); markDirty(); }} className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none" />
          </div>
          <div className="col-span-2 md:col-span-1">
            <label className="block text-xs text-ink-secondary">备注（可选，≤500）</label>
            <input value={remark} onChange={(e) => { setRemark(e.target.value); markDirty(); }} maxLength={500} className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none" />
          </div>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink-secondary">发票行（至少一行；双溯源 PO 行 + 已过账入库行）</h2>
          <button type="button" onClick={addLine} className="bg-brand-600 hover:bg-brand-700 rounded-md px-3 py-1.5 text-sm font-medium text-white">+ 添加行</button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
              <tr>
                <th className="px-2 py-2">PO 行 ID</th>
                <th className="px-2 py-2">入库行 ID</th>
                <th className="px-2 py-2">数量</th>
                <th className="px-2 py-2">单价</th>
                <th className="px-2 py-2">税率%</th>
                <th className="px-2 py-2">可抵扣</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((line, idx) => (
                <tr key={idx}>
                  <td className="px-2 py-2">
                    <input value={line.purchaseOrderLineId} onChange={(e) => updateLine(idx, { purchaseOrderLineId: e.target.value })} className="focus:border-brand-500 w-full min-w-32 rounded-md border border-border px-2 py-1.5 focus:outline-none" />
                  </td>
                  <td className="px-2 py-2">
                    <input value={line.warehouseReceiptLineId} onChange={(e) => updateLine(idx, { warehouseReceiptLineId: e.target.value })} className="focus:border-brand-500 w-full min-w-32 rounded-md border border-border px-2 py-1.5 focus:outline-none" />
                  </td>
                  <td className="px-2 py-2">
                    <input type="number" min="0" step="any" value={line.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} className="focus:border-brand-500 w-24 rounded-md border border-border px-2 py-1.5 focus:outline-none" />
                  </td>
                  <td className="px-2 py-2">
                    <input type="number" min="0" step="any" value={line.unitPrice} onChange={(e) => updateLine(idx, { unitPrice: e.target.value })} className="focus:border-brand-500 w-24 rounded-md border border-border px-2 py-1.5 focus:outline-none" />
                  </td>
                  <td className="px-2 py-2">
                    <input type="number" min="0" max="100" step="any" value={line.taxRate} onChange={(e) => updateLine(idx, { taxRate: e.target.value })} className="focus:border-brand-500 w-20 rounded-md border border-border px-2 py-1.5 focus:outline-none" />
                  </td>
                  <td className="px-2 py-2">
                    <input type="checkbox" checked={line.vatRecoverable} onChange={(e) => updateLine(idx, { vatRecoverable: e.target.checked })} className="h-4 w-4 accent-brand-600" />
                  </td>
                  <td className="px-2 py-2">
                    <button type="button" onClick={() => removeLine(idx)} disabled={lines.length <= 1} className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40">删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {Object.keys(fieldErrors).length > 0 && (
          <p className="mt-2 text-xs text-status-danger-text">{Object.values(fieldErrors).filter(Boolean)[0] ?? ""}</p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button type="button" onClick={handleSubmit} disabled={submitting} className="bg-brand-600 hover:bg-brand-700 rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
            {submitting ? "提交中…" : "创建（DRAFT）"}
          </button>
          {dirty && <span className="text-xs text-status-warning-text">有未保存的更改</span>}
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("supplier-invoice", "create")}>
      <SupplierInvoiceCreateForm />
    </PermissionGuard>
  );
}