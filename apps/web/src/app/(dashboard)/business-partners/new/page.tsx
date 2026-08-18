"use client";

/**
 * Business Partners — 新建往来单位（Pending Pages Completion Gate — Batch 1）
 * 结构：EntityFormWorkspace（Header → Sections → Validation → Save/Cancel）。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";

const TYPE_OPTIONS = [
  { value: "CUSTOMER", label: "客户" },
  { value: "SUPPLIER", label: "供应商" },
  { value: "BOTH", label: "客户兼供应商" },
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

function BusinessPartnerCreateForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("SUPPLIER");
  const [uscc, setUscc] = useState("");
  const [taxpayerType, setTaxpayerType] = useState("");
  const [legalRepresentative, setLegalRepresentative] = useState("");
  const [region, setRegion] = useState("");
  const [industry, setIndustry] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [settlementTerms, setSettlementTerms] = useState("");
  const [registeredCapital, setRegisteredCapital] = useState("");
  const [employeeCount, setEmployeeCount] = useState("");
  const [website, setWebsite] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

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
      mnemonic: mnemonic.trim() || undefined,
      name: name.trim(),
      type,
      uscc: uscc.trim() || undefined,
      taxpayerType: taxpayerType.trim() || undefined,
      legalRepresentative: legalRepresentative.trim() || undefined,
      region: region.trim() || undefined,
      industry: industry.trim() || undefined,
      companySize: companySize.trim() || undefined,
      contactPerson: contactPerson.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      address: address.trim() || undefined,
      bankName: bankName.trim() || undefined,
      bankAccount: bankAccount.trim() || undefined,
      settlementTerms: settlementTerms.trim() || undefined,
      registeredCapital: registeredCapital.trim() || undefined,
      employeeCount: employeeCount ? Number(employeeCount) : undefined,
      website: website.trim() || undefined,
    };
    apiFetch<{ id: string }>("/api/business-partners", {
      method: "POST",
      body: JSON.stringify(payload),
    })
      .then(() => router.push("/business-partners"))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  return (
    <EntityFormWorkspace
      title="新建往来单位"
      description="客户/供应商/客户兼供应商统一主数据"
      backHref="/business-partners"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSave}
      onCancel={() => router.push("/business-partners")}
    >
      <Section title="基本信息">
        <Field label="编码" required>
          <input value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} placeholder="唯一内部编码" />
        </Field>
        <Field label="名称" required>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="助记码">
          <input value={mnemonic} onChange={(e) => setMnemonic(e.target.value)} className={inputClass} />
        </Field>
        <Field label="类型">
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="统一社会信用代码">
          <input value={uscc} onChange={(e) => setUscc(e.target.value)} className={inputClass} placeholder="18 位统一社会信用代码（GB 32100-2015）" />
        </Field>
        <Field label="纳税人类型">
          <input value={taxpayerType} onChange={(e) => setTaxpayerType(e.target.value)} className={inputClass} placeholder="一般纳税人/小规模纳税人" />
        </Field>
        <Field label="法定代表人">
          <input value={legalRepresentative} onChange={(e) => setLegalRepresentative(e.target.value)} className={inputClass} />
        </Field>
      </Section>
      <Section title="联系与区域">
        <Field label="区域">
          <input value={region} onChange={(e) => setRegion(e.target.value)} className={inputClass} />
        </Field>
        <Field label="行业">
          <input value={industry} onChange={(e) => setIndustry(e.target.value)} className={inputClass} />
        </Field>
        <Field label="企业规模">
          <input value={companySize} onChange={(e) => setCompanySize(e.target.value)} className={inputClass} />
        </Field>
        <Field label="联系人">
          <input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className={inputClass} />
        </Field>
        <Field label="电话">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
        </Field>
        <Field label="邮箱">
          <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </Field>
        <Field label="地址">
          <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
        </Field>
      </Section>
      <Section title="财务与开票">
        <Field label="开户银行">
          <input value={bankName} onChange={(e) => setBankName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="银行账号">
          <input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} className={inputClass} />
        </Field>
        <Field label="结算条款">
          <input value={settlementTerms} onChange={(e) => setSettlementTerms(e.target.value)} className={inputClass} />
        </Field>
        <Field label="注册资本（万元）">
          <input value={registeredCapital} onChange={(e) => setRegisteredCapital(e.target.value)} className={inputClass} />
        </Field>
        <Field label="员工人数">
          <input type="number" value={employeeCount} onChange={(e) => setEmployeeCount(e.target.value)} className={inputClass} />
        </Field>
        <Field label="官网">
          <input value={website} onChange={(e) => setWebsite(e.target.value)} className={inputClass} />
        </Field>
      </Section>
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("business-partner", "create")}>
      <AppPage>
        <BusinessPartnerCreateForm />
      </AppPage>
    </PermissionGuard>
  );
}