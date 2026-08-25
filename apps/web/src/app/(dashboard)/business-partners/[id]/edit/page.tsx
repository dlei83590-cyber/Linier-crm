"use client";

/**
 * Business Partners — 编辑往来单位（Pending Pages Completion Gate — Batch 1）
 * CAS：表单携带详情返回的 version，409 冲突时提示刷新重试。
 */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";
import { validateUscc } from "@/lib/tax-invoice";
import { useToast } from "@/components/ui/toast";
import { PageLoading } from "@/components/ui/skeleton";

interface BusinessPartnerDetail {
  id: string;
  code: string;
  mnemonic: string | null;
  name: string;
  type: string;
  uscc: string | null;
  taxpayerType: string | null;
  legalRepresentative: string | null;
  region: string | null;
  industry: string | null;
  companySize: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  bankName: string | null;
  bankAccount: string | null;
  settlementTerms: string | null;
  creditRating: string | null;
  registeredCapital: string | null;
  employeeCount: number | null;
  website: string | null;
  isActive: boolean;
  version: number;
  invoiceInfoRecord?: {
    id: string;
    title: string | null;
    uscc: string | null;
    taxpayerType: string | null;
    registeredAddress: string | null;
    registeredPhone: string | null;
    bankName: string | null;
    bankAccountNo: string | null;
  } | null;
}

const TYPE_OPTIONS = [
  { value: "CUSTOMER", label: "客户" },
  { value: "SUPPLIER", label: "供应商" },
  { value: "BOTH", label: "客户兼供应商" },
];

const inputClass = INPUT_CLASS;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink-primary">{title}</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>
    </section>
  );
}


function BusinessPartnerEditForm() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const toast = useToast();

  const [code, setCode] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("SUPPLIER");
  const [uscc, setUscc] = useState("");
  // 开票资料（ADR-0043，F3）：结构化 taxInvoiceInfo
  const [invTitle, setInvTitle] = useState("");
  const [invUscc, setInvUscc] = useState("");
  const [invTaxpayerType, setInvTaxpayerType] = useState("GENERAL_VAT_PAYER");
  const [invRegAddress, setInvRegAddress] = useState("");
  const [invRegPhone, setInvRegPhone] = useState("");
  const [invBankName, setInvBankName] = useState("");
  const [invBankAccount, setInvBankAccount] = useState("");
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
  const [creditRating, setCreditRating] = useState("");
  const [registeredCapital, setRegisteredCapital] = useState("");
  const [employeeCount, setEmployeeCount] = useState("");
  const [website, setWebsite] = useState("");
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
    apiFetch<BusinessPartnerDetail>(`/api/business-partners/${id}`)
      .then((body) => {
        const d = body.data;
        setCode(d.code);
        setMnemonic(d.mnemonic ?? "");
        setName(d.name);
        setType(d.type);
        setUscc(d.uscc ?? "");
        setTaxpayerType(d.taxpayerType ?? "");
        setLegalRepresentative(d.legalRepresentative ?? "");
        setRegion(d.region ?? "");
        setIndustry(d.industry ?? "");
        setCompanySize(d.companySize ?? "");
        setContactPerson(d.contactPerson ?? "");
        setPhone(d.phone ?? "");
        setEmail(d.email ?? "");
        setAddress(d.address ?? "");
        setBankName(d.bankName ?? "");
        setBankAccount(d.bankAccount ?? "");
        setSettlementTerms(d.settlementTerms ?? "");
        setCreditRating(d.creditRating ?? "");
        setRegisteredCapital(d.registeredCapital ? String(d.registeredCapital) : "");
        setEmployeeCount(d.employeeCount ? String(d.employeeCount) : "");
        setWebsite(d.website ?? "");
        setIsActive(d.isActive);
        setVersion(d.version);
        // 开票资料（ADR-0043，F3）：开票税号默认取往来单位主档 uscc（开票税号 = 统一社会信用代码，与往来单位一致）
        setInvTitle(d.invoiceInfoRecord?.title ?? "");
        setInvUscc(d.invoiceInfoRecord?.uscc ?? d.uscc ?? "");
        setInvTaxpayerType(d.invoiceInfoRecord?.taxpayerType ?? "GENERAL_VAT_PAYER");
        setInvRegAddress(d.invoiceInfoRecord?.registeredAddress ?? "");
        setInvRegPhone(d.invoiceInfoRecord?.registeredPhone ?? "");
        setInvBankName(d.invoiceInfoRecord?.bankName ?? "");
        setInvBankAccount(d.invoiceInfoRecord?.bankAccountNo ?? "");
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
    if (!name.trim()) {
      setError(new ApiClientError(400, "名称为必填项", "VALIDATION"));
      return;
    }
    // 开票资料（ADR-0043）：开票抬头/开票税号必填（任一开始填写 → 两者必填）+ uscc GB 32100-2015 校验
    const invTitleV = invTitle.trim();
    const invUsccV = invUscc.trim();
    if (invTitleV || invUsccV) {
      if (!invTitleV) {
        setError(new ApiClientError(400, "开票抬头为必填项（开票资料已开始填写）", "VALIDATION"));
        return;
      }
      if (!invUsccV) {
        setError(new ApiClientError(400, "开票税号为必填项（开票资料已开始填写）", "VALIDATION"));
        return;
      }
      if (!validateUscc(invUsccV)) {
        setError(new ApiClientError(400, "统一社会信用代码非法（GB 32100-2015，18 位含校验码）", "USCC_INVALID"));
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    const payload: Record<string, unknown> = {
      version,
      code: code.trim() || undefined,
      mnemonic: mnemonic.trim() || null,
      name: name.trim(),
      type,
      uscc: uscc.trim() || null,
      taxpayerType: taxpayerType.trim() || null,
      legalRepresentative: legalRepresentative.trim() || null,
      region: region.trim() || null,
      industry: industry.trim() || null,
      companySize: companySize.trim() || null,
      contactPerson: contactPerson.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      address: address.trim() || null,
      bankName: bankName.trim() || null,
      bankAccount: bankAccount.trim() || null,
      settlementTerms: settlementTerms.trim() || null,
      creditRating: creditRating.trim() || null,
      registeredCapital: registeredCapital.trim() || null,
      employeeCount: employeeCount ? Number(employeeCount) : null,
      website: website.trim() || null,
      isActive,
      // 开票资料（ADR-0043，F3；抬头与税号同时填写才提交——必填已由上方校验保证）
      ...(invTitle.trim() && invUscc.trim()
        ? {
            taxInvoiceInfo: {
              title: invTitle.trim(),
              uscc: invUscc.trim(),
              taxpayerType: invTaxpayerType as "GENERAL_VAT_PAYER" | "SMALL_SCALE",
              registeredAddress: invRegAddress.trim() || null,
              registeredPhone: invRegPhone.trim() || null,
              bankName: invBankName.trim() || null,
              bankAccountNo: invBankAccount.trim() || null,
            },
          }
        : {}),
    };
    apiFetch<{ id: string }>(`/api/business-partners/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    })
      .then(() => {
        toast.success("往来单位已保存");
        router.push("/business-partners");
      })
      .catch((err: unknown) => {
        toast.error("保存失败", err instanceof ApiClientError ? err.message : "网络错误");
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  if (loading) {
    return (
      <EntityFormWorkspace title="编辑往来单位" backHref="/business-partners" mode="edit" submitting={false} onSave={handleSave} onCancel={() => router.push("/business-partners")}>
        <PageLoading rows={4} />
      </EntityFormWorkspace>
    );
  }

  if (loadError) {
    return (
      <EntityFormWorkspace title="编辑往来单位" backHref="/business-partners" mode="edit" submitting={false} error={loadError} onSave={handleSave} onCancel={() => router.push("/business-partners")}>
        <p className="px-4 py-6 text-sm text-ink-secondary">加载失败</p>
      </EntityFormWorkspace>
    );
  }

  return (
    <EntityFormWorkspace
      title="编辑往来单位"
      description={`编码：${code}`}
      backHref="/business-partners"
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
      onCancel={() => router.push("/business-partners")}
    >
      <Section title="基本信息">
        <FormField label="编码" required>
          <input value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="名称" required>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="助记码">
          <input value={mnemonic} onChange={(e) => setMnemonic(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="类型">
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="统一社会信用代码">
          <input value={uscc} onChange={(e) => setUscc(e.target.value)} className={inputClass} placeholder="18 位统一社会信用代码（GB 32100-2015）" />
        </FormField>
        <FormField label="纳税人类型">
          <input value={taxpayerType} onChange={(e) => setTaxpayerType(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="法定代表人">
          <input value={legalRepresentative} onChange={(e) => setLegalRepresentative(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="启用">
          <select value={isActive ? "true" : "false"} onChange={(e) => setIsActive(e.target.value === "true")} className={inputClass}>
            <option value="true">是</option>
            <option value="false">否</option>
          </select>
        </FormField>
      </Section>
      <Section title="联系与区域">
        <FormField label="区域">
          <input value={region} onChange={(e) => setRegion(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="行业">
          <input value={industry} onChange={(e) => setIndustry(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="企业规模">
          <input value={companySize} onChange={(e) => setCompanySize(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="联系人">
          <input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="电话">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="邮箱">
          <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="地址">
          <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
        </FormField>
      </Section>
      <Section title="财务与开票">
        <FormField label="开户银行">
          <input value={bankName} onChange={(e) => setBankName(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="银行账号">
          <input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="结算条款">
          <input value={settlementTerms} onChange={(e) => setSettlementTerms(e.target.value)} className={inputClass} placeholder="如 NET30 / 月结 30 天" />
        </FormField>
        <FormField label="信用等级">
          <input value={creditRating} onChange={(e) => setCreditRating(e.target.value)} className={inputClass} placeholder="如 AAA / AA / A / B / C" />
        </FormField>
        <FormField label="注册资本（万元）">
          <input value={registeredCapital} onChange={(e) => setRegisteredCapital(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="员工人数">
          <input type="number" value={employeeCount} onChange={(e) => setEmployeeCount(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="官网">
          <input value={website} onChange={(e) => setWebsite(e.target.value)} className={inputClass} />
        </FormField>
      </Section>
      <Section title="开票资料">
        <FormField label="开票抬头" required>
          <input value={invTitle} onChange={(e) => setInvTitle(e.target.value)} className={inputClass} placeholder="发票抬头（MUST = 营业执照企业全称）" />
        </FormField>
        <FormField label="开票税号" required>
          <input value={invUscc} onChange={(e) => setInvUscc(e.target.value)} className={inputClass} placeholder="18 位统一社会信用代码（GB 32100-2015）" />
          {invUscc.trim() && !validateUscc(invUscc) && (
            <p className="mt-1 text-xs text-red-500">统一社会信用代码格式不正确（GB 32100-2015）</p>
          )}
        </FormField>
        <FormField label="纳税人类型">
          <select value={invTaxpayerType} onChange={(e) => setInvTaxpayerType(e.target.value)} className={inputClass}>
            <option value="GENERAL_VAT_PAYER">一般纳税人</option>
            <option value="SMALL_SCALE">小规模纳税人</option>
          </select>
        </FormField>
        <FormField label="注册地址">
          <input value={invRegAddress} onChange={(e) => setInvRegAddress(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="注册电话">
          <input value={invRegPhone} onChange={(e) => setInvRegPhone(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="开户银行">
          <input value={invBankName} onChange={(e) => setInvBankName(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="银行账号">
          <input value={invBankAccount} onChange={(e) => setInvBankAccount(e.target.value)} className={inputClass} />
        </FormField>
      </Section>
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("business-partner", "edit")}>
      <AppPage>
        <BusinessPartnerEditForm />
      </AppPage>
    </PermissionGuard>
  );
}