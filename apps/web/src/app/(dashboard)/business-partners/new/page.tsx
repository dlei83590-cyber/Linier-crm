"use client";

/**
 * Business Partners — 新建往来单位（Pending Pages Completion Gate — Batch 1）
 * Phase 2B（客户查重 Vertical Slice）：name/uscc/phone blur + 400ms debounce → duplicate-check
 * EXACT 阻断提交 / POTENTIAL 确认后携带 duplicateAcknowledged=true / stale 防护；保存前 Server Guard 最终裁决。
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";
import { BUSINESS_PARTNER_CHANNELS } from "@/lib/business-partner/channel";
import {
  computeDuplicateUiState,
  shouldRunDuplicateCheck,
  isStaleDuplicateResult,
  withAcknowledgment,
  duplicateReasonLabel,
  type DuplicateCheckView,
} from "@/lib/frontend/duplicate-check";

const TYPE_OPTIONS = [
  { value: "CUSTOMER", label: "客户" },
  { value: "SUPPLIER", label: "供应商" },
  { value: "BOTH", label: "客户兼供应商" },
];

const TYPE_LABELS: Record<string, string> = { CUSTOMER: "客户", SUPPLIER: "供应商", BOTH: "客户兼供应商" };
const DEBOUNCE_MS = 400;

const inputClass = INPUT_CLASS;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-elevation-sm">
      <h2 className="mb-4 text-sm font-semibold text-ink-primary">{title}</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>
    </section>
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
  const [channel, setChannel] = useState("");
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
  // cc-06 客户等级→供应商评级匹配：客户等级（VIP/KEY/REGULAR/PROSPECT；仅 CUSTOMER/BOTH 可设）
  const [customerLevel, setCustomerLevel] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  // Phase 2B：查重状态
  const [dupResult, setDupResult] = useState<DuplicateCheckView | null>(null);
  const [dupLoading, setDupLoading] = useState(false);
  const [dupAcknowledged, setDupAcknowledged] = useState(false);
  const dupSeqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runDuplicateCheck = () => {
    if (!shouldRunDuplicateCheck(name, uscc, phone)) {
      setDupResult(null);
      setDupAcknowledged(false);
      return;
    }
    const seq = ++dupSeqRef.current;
    setDupLoading(true);
    apiFetch<DuplicateCheckView>("/api/business-partners/duplicate-check", {
      method: "POST",
      body: JSON.stringify({
        name: name.trim() || undefined,
        uscc: uscc.trim() || undefined,
        phone: phone.trim() || undefined,
      }),
    })
      .then(({ data }) => {
        if (isStaleDuplicateResult(seq, dupSeqRef.current)) return; // stale 响应不覆盖新结果
        setDupResult(data);
        setDupAcknowledged(false);
      })
      .catch(() => {
        if (isStaleDuplicateResult(seq, dupSeqRef.current)) return;
        // 查重失败静默降级：不阻断主流程，保存时由 Server Guard 兜底裁决
        setDupResult(null);
      })
      .finally(() => {
        if (!isStaleDuplicateResult(seq, dupSeqRef.current)) setDupLoading(false);
      });
  };

  const scheduleDuplicateCheck = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(runDuplicateCheck, DEBOUNCE_MS);
  };

  const dupState = computeDuplicateUiState(dupResult?.duplicateLevel, dupAcknowledged);

  const handleSave = () => {
    if (submitting) return;
    if (!code.trim() || !name.trim()) {
      setError(new ApiClientError(400, "编码与名称为必填项", "VALIDATION"));
      return;
    }
    // UI 层 EXACT 阻断（Server Guard 仍会在保存时最终裁决）
    if (dupState.blocking) {
      setError(
        new ApiClientError(
          409,
          "已存在匹配往来单位，禁止重复创建。请复用已有主体，或通过主数据流程调整客户角色/类型。",
          "DUPLICATE_EXACT",
        ),
      );
      return;
    }
    if (dupState.warning && !dupState.confirmed) {
      setError(new ApiClientError(409, "已存在疑似重复的往来单位，请先勾选确认后继续创建。", "DUPLICATE_REQUIRES_ACK"));
      return;
    }
    setSubmitting(true);
    setError(null);
    const payload: Record<string, unknown> = withAcknowledgment(
      {
        code: code.trim(),
        mnemonic: mnemonic.trim() || undefined,
        name: name.trim(),
        type,
        uscc: uscc.trim() || undefined,
        taxpayerType: taxpayerType.trim() || undefined,
        legalRepresentative: legalRepresentative.trim() || undefined,
        region: region.trim() || undefined,
        industry: industry.trim() || undefined,
        channel: channel || undefined,
        companySize: companySize.trim() || undefined,
        contactPerson: contactPerson.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        address: address.trim() || undefined,
        bankName: bankName.trim() || undefined,
        bankAccount: bankAccount.trim() || undefined,
        settlementTerms: settlementTerms.trim() || undefined,
        customerLevel: type === "CUSTOMER" || type === "BOTH" ? customerLevel || undefined : undefined,
        registeredCapital: registeredCapital.trim() || undefined,
        employeeCount: employeeCount ? Number(employeeCount) : undefined,
        website: website.trim() || undefined,
      },
      dupState.warning && dupState.confirmed,
    );
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
      {/* Phase 2B：查重提示区（EXACT 阻断卡 / POTENTIAL 确认卡；NONE 不打扰） */}
      {dupLoading && <div className="mb-3 text-xs text-ink-muted">正在查重…</div>}
      {dupState.visible && dupResult && dupResult.matches.length > 0 && (
        <div
          className={
            "mb-4 rounded-lg border p-3.5 " +
            (dupState.blocking
              ? "border-status-danger-border bg-status-danger-bg text-status-danger-text"
              : "border-status-warning-border bg-status-warning-bg text-status-warning-text")
          }
        >
          <p className="text-sm font-semibold">
            {dupState.blocking ? "已存在匹配往来单位（禁止重复创建）" : "已存在疑似重复的往来单位"}
          </p>
          <ul className="mt-2 space-y-2">
            {dupResult.matches.map((m) => (
              <li key={m.id} className="text-xs">
                <span className="font-medium">{m.name}</span>
                <span className="ml-1 text-ink-muted">（{m.code} · {TYPE_LABELS[m.type] ?? m.type}）</span>
                {m.isActive === false && <span className="ml-1 text-ink-muted">· 已停用</span>}
                <div className="mt-0.5 text-ink-muted">
                  {m.usccMasked && <span>USCC: {m.usccMasked}　</span>}
                  {m.phoneMasked && <span>电话: {m.phoneMasked}　</span>}
                  {m.matchReasons.map((r) => duplicateReasonLabel(r)).join("；")}
                </div>
              </li>
            ))}
          </ul>
          {dupState.blocking ? (
            <p className="mt-2 text-xs">
              如需复用已有主体，请通过主数据流程调整其客户/供应商角色或类型，不要重复新建。
            </p>
          ) : (
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={dupAcknowledged}
                onChange={(e) => setDupAcknowledged(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              确认继续创建（将记录审计）
            </label>
          )}
        </div>
      )}
      <Section title="基本信息">
        <FormField label="编码" required>
          <input value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} placeholder="唯一内部编码" />
        </FormField>
        <FormField label="名称" required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={scheduleDuplicateCheck}
            className={inputClass}
          />
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
        {(type === "CUSTOMER" || type === "BOTH") && (
          <FormField label="客户等级">
            <select value={customerLevel} onChange={(e) => setCustomerLevel(e.target.value)} className={inputClass}>
              <option value="">未设置</option>
              <option value="VIP">VIP</option>
              <option value="KEY">重点（KEY）</option>
              <option value="REGULAR">普通（REGULAR）</option>
              <option value="PROSPECT">潜在（PROSPECT）</option>
            </select>
          </FormField>
        )}
        <FormField label="统一社会信用代码">
          <input
            value={uscc}
            onChange={(e) => setUscc(e.target.value)}
            onBlur={scheduleDuplicateCheck}
            className={inputClass}
            placeholder="18 位统一社会信用代码（GB 32100-2015）"
          />
        </FormField>
        <FormField label="纳税人类型">
          <input value={taxpayerType} onChange={(e) => setTaxpayerType(e.target.value)} className={inputClass} placeholder="一般纳税人/小规模纳税人" />
        </FormField>
        <FormField label="法定代表人">
          <input value={legalRepresentative} onChange={(e) => setLegalRepresentative(e.target.value)} className={inputClass} />
        </FormField>
      </Section>
      <Section title="联系与区域">
        <FormField label="区域">
          <input value={region} onChange={(e) => setRegion(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="行业">
          <input value={industry} onChange={(e) => setIndustry(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="销售渠道">
          <select value={channel} onChange={(e) => setChannel(e.target.value)} className={inputClass}>
            <option value="">未设置</option>
            {BUSINESS_PARTNER_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="企业规模">
          <input value={companySize} onChange={(e) => setCompanySize(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="联系人">
          <input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="电话">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={scheduleDuplicateCheck}
            className={inputClass}
          />
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
          <input value={settlementTerms} onChange={(e) => setSettlementTerms(e.target.value)} className={inputClass} />
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
