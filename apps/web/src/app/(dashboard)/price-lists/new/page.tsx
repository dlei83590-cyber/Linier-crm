"use client";

/**
 * Price Lists — 新建价格表（F2-2 Master Data Workspaces）
 *
 * 依据 Contract Card（price-lists.md）：backend create FINAL → 实现 Create。
 * 结构：EntityFormWorkspace（Header → Sections → Validation → Save/Cancel）。
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace, ReferenceSelector } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";

interface PolicyOption {
  id: string;
  code: string | null;
  name: string | null;
}

const PRICE_TYPE_OPTIONS = [
  { value: "PURCHASE", label: "采购" },
  { value: "SALES", label: "销售" },
  { value: "VIP", label: "VIP" },
  { value: "AGENT", label: "代理" },
  { value: "ENGINEERING", label: "工程" },
  { value: "STRATEGIC", label: "战略" },
  { value: "REGIONAL", label: "区域" },
  { value: "CUSTOMER", label: "客户" },
  { value: "HISTORICAL", label: "历史" },
];

const STATUS_OPTIONS = [
  { value: "DRAFT", label: "草稿" },
  { value: "PUBLISHED", label: "已发布" },
  { value: "ARCHIVED", label: "已归档" },
];

const PRICE_SOURCE_OPTIONS = [
  { value: "MANUAL", label: "手工" },
  { value: "IMPORT", label: "导入" },
  { value: "FORMULA", label: "公式" },
  { value: "PROMOTION", label: "促销" },
  { value: "SUPPLIER", label: "供应商" },
  { value: "MARKET", label: "市场" },
];

const inputClass =
  "w-full rounded-md border border-border px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted focus:border-brand-500 focus:outline-none";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink-primary">{title}</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>
    </section>
  );
}

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

function PriceListCreateForm() {
  const router = useRouter();
  const [policies, setPolicies] = useState<PolicyOption[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(true);
  const [policiesError, setPoliciesError] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [priceType, setPriceType] = useState("");
  const [currency, setCurrency] = useState("");
  const [baseCurrency, setBaseCurrency] = useState("");
  const [quoteCurrency, setQuoteCurrency] = useState("");
  const [pricePolicyId, setPricePolicyId] = useState("");
  const [status, setStatus] = useState("DRAFT");
  const [priceSource, setPriceSource] = useState("");
  const [freightIncluded, setFreightIncluded] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  // F2-2 UX Hardening ①：Dirty-State Guard（填写内容后离开需确认）
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<PolicyOption[]>("/api/price-policies?pageSize=100", { signal: controller.signal })
      .then((body) => {
        setPolicies(body.data);
        setPoliciesLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setPoliciesError("加载价格策略失败");
        setPoliciesLoading(false);
      });
    return () => controller.abort();
  }, []);

  const handleSave = () => {
    if (submitting) return;
    if (!code.trim() || !name.trim()) {
      setError(new ApiClientError(400, "编码与名称为必填项", "VALIDATION"));
      return;
    }
    setSubmitting(true);
    setError(null);
    const payload: Record<string, unknown> = {
      code: code.trim(),
      name: name.trim(),
      priceType: priceType || undefined,
      currency: currency.trim() || undefined,
      baseCurrency: baseCurrency.trim() || undefined,
      quoteCurrency: quoteCurrency.trim() || undefined,
      pricePolicyId: pricePolicyId || null,
      status: status || undefined,
      priceSource: priceSource || undefined,
      freightIncluded,
      effectiveFrom: effectiveFrom ? new Date(effectiveFrom).toISOString() : null,
      effectiveTo: effectiveTo ? new Date(effectiveTo).toISOString() : null,
      validFrom: validFrom ? new Date(validFrom).toISOString() : null,
      validTo: validTo ? new Date(validTo).toISOString() : null,
    };
    apiFetch<{ id: string }>("/api/price-lists", {
      method: "POST",
      body: JSON.stringify(payload),
    })
      .then((body) => router.push(`/price-lists/${body.data.id}`))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  return (
    <EntityFormWorkspace
      title="新建价格表"
      description="创建统一价格主数据"
      backHref="/price-lists"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSave}
      onCancel={() => router.push("/price-lists")}
    >
      <Section title="基本信息">
        <Field label="编码" required>
          <input value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} placeholder="唯一编码" />
        </Field>
        <Field label="名称" required>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="价格类型">
          <select value={priceType} onChange={(e) => setPriceType(e.target.value)} className={inputClass}>
            <option value="">请选择</option>
            {PRICE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="状态">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="价格策略">
          <ReferenceSelector
            value={pricePolicyId}
            onChange={setPricePolicyId}
            options={policies.map((p) => ({ value: p.id, label: p.name ?? p.code ?? "" }))}
            placeholder="请选择策略"
            loading={policiesLoading}
            error={policiesError}
          />
        </Field>
        <Field label="币种">
          <input value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass} placeholder="如 CNY / USD" />
        </Field>
        <Field label="基准币种">
          <input value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)} className={inputClass} />
        </Field>
        <Field label="报价币种">
          <input value={quoteCurrency} onChange={(e) => setQuoteCurrency(e.target.value)} className={inputClass} />
        </Field>
        <Field label="价格来源">
          <select value={priceSource} onChange={(e) => setPriceSource(e.target.value)} className={inputClass}>
            <option value="">请选择</option>
            {PRICE_SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="有效期">
        <Field label="生效日期">
          <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className={inputClass} />
        </Field>
        <Field label="失效日期">
          <input type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} className={inputClass} />
        </Field>
        <Field label="有效起始">
          <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className={inputClass} />
        </Field>
        <Field label="有效截止">
          <input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} className={inputClass} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-ink-secondary">
          <input type="checkbox" checked={freightIncluded} onChange={(e) => setFreightIncluded(e.target.checked)} />
          含运费
        </label>
      </Section>
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("price-list", "create")}>
      <AppPage>
        <PriceListCreateForm />
      </AppPage>
    </PermissionGuard>
  );
}
