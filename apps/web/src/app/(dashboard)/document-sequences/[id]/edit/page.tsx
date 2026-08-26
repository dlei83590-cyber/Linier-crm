"use client";

/** Document Sequences — 编辑单据序列（Pending Pages Completion Gate — Batch 1；nextNo 只读，CAS version） */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { PageLoading } from "@/components/ui/skeleton";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";
import { useToast } from "@/components/ui/toast";
import { sequenceFormatPreview } from "@/lib/document-sequence/format";

interface DocumentSequenceDetail {
  id: string;
  code: string;
  name: string;
  docType: string;
  prefix: string | null;
  startNo: number;
  padLength: number;
  periodPattern: string | null;
  perPeriodReset: boolean;
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

const inputClass = INPUT_CLASS;


function DocumentSequenceEditForm() {
  const router = useRouter();
  const toast = useToast();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [docType, setDocType] = useState("");
  const [prefix, setPrefix] = useState("");
  const [startNo, setStartNo] = useState(1); // 起始序号
  const [padLength, setPadLength] = useState("4");
  const [periodPattern, setPeriodPattern] = useState("LNE{YYYY}{MM}");
  const [perPeriodReset, setPerPeriodReset] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [resetBusy, setResetBusy] = useState(false);
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
        setStartNo(d.startNo);
        setPadLength(String(d.padLength));
        setPeriodPattern(d.periodPattern ?? "LNE{YYYY}{MM}");
        setPerPeriodReset(d.perPeriodReset);
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
      startNo: Number(startNo) || 1,
      periodPattern: periodPattern.trim() || null,
      perPeriodReset,
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

  const handleReset = () => {
    if (resetBusy) return;
    if (!window.confirm("确认将「当前业务月」的序号重置为起始序号？该期间已发出的号码可能重复，请谨慎操作。")) return;
    setResetBusy(true);
    apiFetch<{ reset: boolean; periodKey: string; nextNo: number }>(`/api/document-sequences/${id}/reset`, {
      method: "POST",
      body: JSON.stringify({}),
    })
      .then(() => toast.success("已重置当前期间序号"))
      .catch((err: unknown) => {
        toast.error("重置失败", err instanceof ApiClientError ? err.message : "网络错误");
      })
      .finally(() => setResetBusy(false));
  };

  if (loading) {
    return (
      <EntityFormWorkspace title="编辑单据序列" backHref="/document-sequences" mode="edit" submitting={false} onSave={handleSave} onCancel={() => router.push("/document-sequences")}>
        <PageLoading rows={4} />
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
          <FormField label="编码" required>
            <input value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} />
          </FormField>
          <FormField label="名称" required>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </FormField>
          <FormField label="单据类型" required>
            <select value={docType} onChange={(e) => setDocType(e.target.value)} className={inputClass}>
              {DOC_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="前缀">
            <input value={prefix} onChange={(e) => setPrefix(e.target.value)} className={inputClass} />
          </FormField>
          <FormField label="序号位数">
            <input type="number" min={1} max={12} value={padLength} onChange={(e) => setPadLength(e.target.value)} className={inputClass} />
          </FormField>
          <FormField label="起始序号">
            <input type="number" min={1} value={startNo} onChange={(e) => setStartNo(Number(e.target.value) || 1)} className={inputClass} />
          </FormField>
          <FormField label="期间段模板">
            <input value={periodPattern} onChange={(e) => setPeriodPattern(e.target.value)} className={inputClass} placeholder="如 LNE{YYYY}{MM}" />
          </FormField>
          <FormField label="按月重排">
            <select value={perPeriodReset ? "true" : "false"} onChange={(e) => setPerPeriodReset(e.target.value === "true")} className={inputClass}>
              <option value="true">是（每年月从起始序号重新计数）</option>
              <option value="false">否（全局连续）</option>
            </select>
          </FormField>
          <FormField label="启用">
            <select value={isActive ? "true" : "false"} onChange={(e) => setIsActive(e.target.value === "true")} className={inputClass}>
              <option value="true">是</option>
              <option value="false">否</option>
            </select>
          </FormField>
        </div>
      </section>
      <section className="rounded-md border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-ink-secondary">
            编号示例：<span className="font-mono">{sequenceFormatPreview({ prefix: prefix.trim() || null, periodPattern: periodPattern.trim() || null, padLength: Number(padLength) || 4 })}</span>
            <span className="ml-2 text-xs">（当前业务月；按月重排时每月从起始序号重新计数）</span>
          </div>
          <button type="button" disabled={resetBusy} onClick={handleReset} className="rounded-md border border-status-danger-border px-3 py-1.5 text-sm text-status-danger-text transition-colors hover:bg-red-50 disabled:opacity-50">
            {resetBusy ? "重置中…" : "重置当前期间序号"}
          </button>
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