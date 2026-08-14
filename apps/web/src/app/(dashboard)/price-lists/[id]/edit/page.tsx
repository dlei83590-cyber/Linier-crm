"use client";

/**
 * Price Lists — 编辑价格表（F2-2 Master Data Workspaces）
 *
 * 依据 Contract Card（price-lists.md）：backend edit FINAL（PATCH + version CAS）→ 实现 Edit。
 */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PERMISSIONS } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace, ReferenceSelector, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";

interface PolicyOption {
  id: string;
  code: string | null;
  name: string | null;
}

interface PriceListDetail {
  id: string;
  code: string;
  name: string;
  priceType?: string | null;
  status?: string | null;
  currency?: string | null;
  baseCurrency?: string | null;
  quoteCurrency?: string | null;
  priceSource?: string | null;
  freightIncluded?: boolean | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  pricePolicyId?: string | null;
  version: number;
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

function PriceListEditForm() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();

  const [policies, setPolicies] = useState<PolicyOption[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(true);

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
  const [version, setVersion] = useState(0);

  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  // F2-2 UX Hardening ①：Dirty-State Guard（修改后离开需确认）
  const [dirty, setDirty] = useState(false);
  // F2-2 UX Hardening ②：409 CAS 后重新加载（重新 GET → 更新 version → 重置 dirty）
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiFetch<PriceListDetail>(`/api/price-lists/${id}`, { signal: controller.signal }),
      apiFetch<PolicyOption[]>("/api/price-policies?pageSize=100", { signal: controller.signal }),
    ])
      .then(([plBody, policyBody]) => {
        const d = plBody.data;
        setCode(d.code);
        setName(d.name);
        setPriceType(d.priceType ?? "");
        setCurrency(d.currency ?? "");
        setBaseCurrency(d.baseCurrency ?? "");
        setQuoteCurrency(d.quoteCurrency ?? "");
        setPricePolicyId(d.pricePolicyId ?? "");
        setStatus(d.status ?? "DRAFT");
        setPriceSource(d.priceSource ?? "");
        setFreightIncluded(d.freightIncluded ?? false);
        setEffectiveFrom(d.effectiveFrom ? d.effectiveFrom.slice(0, 10) : "");
        setEffectiveTo(d.effectiveTo ? d.effectiveTo.slice(0, 10) : "");
        setVersion(d.version);
        setPolicies(policyBody.data);
        setPoliciesLoading(false);
        // 重新加载最新数据后：重置 dirty（409 reload 或首次加载均适用）
        setDirty(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(
          err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"),
        );
        setLoadFailed(true);
      });
    return () => controller.abort();
  }, [id, reloadKey]);

  // F2-2 UX Hardening ②：409 VERSION_CONFLICT 后重新加载最新数据
  const handleReload = () => {
    setError(null);
    setLoadFailed(false);
    setDirty(false);
    setReloadKey((k) => k + 1);
  };

  const handleSave = () => {
    if (submitting) return;
    if (!name.trim()) {
      setError(new ApiClientError(400, "名称为必填项", "VALIDATION"));
      return;
    }
    setSubmitting(true);
    setError(null);
    const payload: Record<string, unknown> = {
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
      version,
    };
    apiFetch<{ id: string }>(`/api/price-lists/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    })
      .then(() => router.push(`/price-lists/${id}`))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  if (loadFailed) {
    return (
      <AppPage>
        <ErrorPanel error={loadError} />
      </AppPage>
    );
  }

  return (
    <EntityFormWorkspace
      title="编辑价格表"
      description={`编码：${code}`}
      backHref={`/price-lists/${id}`}
      mode="edit"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onReload={handleReload}
      onSave={handleSave}
      onCancel={() => router.push(`/price-lists/${id}`)}
    >
      <Section title="基本信息">
        <Field label="编码">
          <input value={code} disabled className={`${inputClass} disabled:bg-slate-50 disabled:text-ink-muted`} />
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
          />
        </Field>
        <Field label="币种">
          <input value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass} />
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
    <PermissionGuard permission={PERMISSIONS.PRICE_LIST_READ}>
      <AppPage>
        <PriceListEditForm />
      </AppPage>
    </PermissionGuard>
  );
}
