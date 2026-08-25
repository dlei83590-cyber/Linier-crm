"use client";

/**
 * Project Opportunities — 新建项目机会（UI-06 Opportunity + Project 现代重构）
 *
 * 依据 Contract Card（project-opportunities.md）：opportunityCreateSchema 事实：
 * code/name/customerId 必填；stage 默认 LEAD；商业预测字段可空。
 * 分区：基本信息 / 商业预测 / 其他；不 40 行平铺。
 * Customer 使用 /api/business-partners?type=CUSTOMER 选择器（P0-1 SSOT：option.id = BusinessPartner.id = POST customerId = 后端校验 id）。
 * Convert（FRT-05 已开放）不在本页——唯一入口在商机详情页「转为项目」按钮。
 * UI-06：不暴露 raw ownerId 输入（红线：无真实用户选择器 API 时不渲染 raw DB ID 输入）；保存成功 Toast。
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { AppPage, EntityFormWorkspace, ReferenceSelector } from "@/components/workspace";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { loadCustomerOptions, type CustomerOption } from "@/lib/frontend/customer-options";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";
import { PROJECT_PAYMENT_OPTIONS, PROJECT_STAGE_OPTIONS } from "@/lib/project-stage";

const inputClass = INPUT_CLASS;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink-primary">{title}</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>
    </section>
  );
}

function OpportunityCreateForm() {
  const router = useRouter();
  const toast = useToast();
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [selectorsLoading, setSelectorsLoading] = useState(true);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [stage, setStage] = useState("LEAD");
  const [customerInvestment, setCustomerInvestment] = useState("");
  const [expectedRevenue, setExpectedRevenue] = useState("");
  const [expectedCost, setExpectedCost] = useState("");
  const [grossProfit, setGrossProfit] = useState("");
  const [expenseBudget, setExpenseBudget] = useState("");
  const [salesTarget, setSalesTarget] = useState("");
  const [successProbability, setSuccessProbability] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("UNPAID");
  const [competitorsText, setCompetitorsText] = useState("");
  const [description, setDescription] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  // Customer selector 数据源（P0-1 SSOT：/api/business-partners?type=CUSTOMER，option.id = BusinessPartner.id）
  useEffect(() => {
    const controller = new AbortController();
    loadCustomerOptions(controller.signal)
      .then((list) => {
        setCustomers(list);
        setSelectorsLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setSelectorsLoading(false);
      });
    return () => controller.abort();
  }, []);

  const numOrUndefined = (v: string): number | undefined => {
    const t = v.trim();
    if (t === "") return undefined;
    const n = Number(t);
    return Number.isNaN(n) ? undefined : n;
  };

  const handleSave = () => {
    if (submitting) return;
    if (!code.trim() || !name.trim() || !customerId) {
      setError(new ApiClientError(400, "编码、名称与客户为必填项", "VALIDATION"));
      return;
    }
    setSubmitting(true);
    setError(null);

    const competitors = competitorsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [cName, ...rest] = line.split("|");
        return { name: cName.trim(), note: rest.join("|").trim() || undefined };
      });

    const payload: Record<string, unknown> = {
      code: code.trim(),
      name: name.trim(),
      customerId,
      stage: stage || undefined,
      customerInvestment: numOrUndefined(customerInvestment),
      expectedRevenue: numOrUndefined(expectedRevenue),
      expectedCost: numOrUndefined(expectedCost),
      grossProfit: numOrUndefined(grossProfit),
      expenseBudget: numOrUndefined(expenseBudget),
      salesTarget: numOrUndefined(salesTarget),
      successProbability: numOrUndefined(successProbability),
      paymentStatus: paymentStatus || undefined,
      competitors: competitors.length > 0 ? competitors : undefined,
      description: description.trim() || null,
    };

    apiFetch<{ id: string }>("/api/project-opportunities", {
      method: "POST",
      body: JSON.stringify(payload),
    })
      .then((body) => {
        toast.success("项目机会已创建");
        router.push(`/project-opportunities/${body.data.id}`);
      })
      .catch((err: unknown) => {
        setError(
          err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"),
        );
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <AppPage>
      <EntityFormWorkspace
        title="新建项目机会"
        description="线索 → 准入 → 方案 → 报价阶段商机管理"
        backHref="/project-opportunities"
        mode="create"
        submitting={submitting}
        error={error}
        dirty={dirty}
        onDirty={() => setDirty(true)}
        onSave={handleSave}
        onCancel={() => router.push("/project-opportunities")}
      >
        <Section title="基本信息">
          <FormField label="机会编号" required>
            <input value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} placeholder="如 OPP-2026-0001" />
          </FormField>
          <FormField label="机会名称" required>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="机会名称" />
          </FormField>
          <FormField label="客户" required>
            <ReferenceSelector
              value={customerId}
              onChange={setCustomerId}
              options={customers.map((c) => ({ value: c.id, label: c.name ?? "", hint: c.code ?? undefined }))}
              loading={selectorsLoading}
              placeholder="请选择客户"
              required
            />
          </FormField>
          <FormField label="阶段">
            <select value={stage} onChange={(e) => setStage(e.target.value)} className={inputClass}>
              {PROJECT_STAGE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </FormField>
        </Section>

        <Section title="商业预测">
          <FormField label="预计营收">
            <input type="number" value={expectedRevenue} onChange={(e) => setExpectedRevenue(e.target.value)} className={inputClass} placeholder="0.00" />
          </FormField>
          <FormField label="预计成本">
            <input type="number" value={expectedCost} onChange={(e) => setExpectedCost(e.target.value)} className={inputClass} placeholder="0.00" />
          </FormField>
          <FormField label="毛利">
            <input type="number" value={grossProfit} onChange={(e) => setGrossProfit(e.target.value)} className={inputClass} placeholder="0.00" />
          </FormField>
          <FormField label="成功率（%）">
            <input type="number" min={0} max={100} value={successProbability} onChange={(e) => setSuccessProbability(e.target.value)} className={inputClass} placeholder="0-100" />
          </FormField>
          <FormField label="销售目标">
            <input type="number" value={salesTarget} onChange={(e) => setSalesTarget(e.target.value)} className={inputClass} placeholder="0.00" />
          </FormField>
          <FormField label="费用预算">
            <input type="number" value={expenseBudget} onChange={(e) => setExpenseBudget(e.target.value)} className={inputClass} placeholder="0.00" />
          </FormField>
          <FormField label="客户投入">
            <input type="number" value={customerInvestment} onChange={(e) => setCustomerInvestment(e.target.value)} className={inputClass} placeholder="0.00" />
          </FormField>
          <FormField label="回款状态">
            <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} className={inputClass}>
              {PROJECT_PAYMENT_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </FormField>
        </Section>

        <Section title="其他">
          <FormField label="竞争对手">
            <textarea
              value={competitorsText}
              onChange={(e) => setCompetitorsText(e.target.value)}
              className={inputClass}
              rows={3}
              placeholder={"每行一个竞争对手，格式：名称 或 名称|备注"}
            />
          </FormField>
          <FormField label="描述">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputClass}
              rows={3}
              placeholder="机会描述（可选）"
            />
          </FormField>
        </Section>
      </EntityFormWorkspace>
    </AppPage>
  );
}

export default function Page() {
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("project-opportunity", "create"));
  if (!canCreate) {
    return (
      <PermissionGuard permission={actionPermission("project-opportunity", "create")}>
        <div className="border-border bg-surface rounded-lg border p-6 text-sm text-ink-muted">
          无新建项目机会权限
        </div>
      </PermissionGuard>
    );
  }
  return (
    <PermissionGuard permission={actionPermission("project-opportunity", "create")}>
      <OpportunityCreateForm />
    </PermissionGuard>
  );
}
