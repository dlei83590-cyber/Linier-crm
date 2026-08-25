"use client";

/**
 * Expenses — 新建报销申请（feat(crm) 报销申请 MVP）
 *
 * 客户（BusinessPartner）→ 项目（Project.customerId 归属）→ 费用科目/金额/日期/备注。
 * 保存复用既有 POST /api/projects/:id/expenses（单一写入源），不新造模型/端点。
 * 级联选择复用 DependentSelector（F2-1 UI System Foundation）。
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { EntityFormWorkspace, DependentSelector } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";
import { useToast } from "@/components/ui/toast";
import type { ReferenceOption } from "@/components/workspace/reference-selector";

interface PartnerOption {
  id: string;
  code: string;
  name: string;
}

interface ProjectOption {
  id: string;
  code: string;
  name: string;
  stage: string | null;
}

// 常见费用科目（复用 ProjectExpense.category 字符串字段，不新建枚举）
const CATEGORY_SUGGESTIONS = [
  "差旅费",
  "交通费",
  "餐饮费",
  "住宿费",
  "办公费",
  "通讯费",
  "业务招待费",
  "培训费",
  "快递费",
  "其他",
];

// 费用类型（高层分类，与科目区分；复用 ProjectExpense.expenseType 字符串字段）
const EXPENSE_TYPE_SUGGESTIONS = ["差旅", "业务招待", "办公", "通讯", "交通", "培训", "其他"];

// 费用归属（谁承担；复用 ProjectExpense.expenseAttribution 字符串字段）
const EXPENSE_ATTRIBUTION_OPTIONS = ["公司承担", "客户承担", "项目承担", "其他"];

const inputClass = INPUT_CLASS;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink-primary">{title}</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>
    </section>
  );
}

function ExpenseCreateForm() {
  const router = useRouter();
  const toast = useToast();

  // 客户/项目级联（Project → BusinessPartner 归属）
  const [customers, setCustomers] = useState<PartnerOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({ customerId: "", projectId: "" });

  const [category, setCategory] = useState("");
  const [expenseType, setExpenseType] = useState("");
  const [expenseAttribution, setExpenseAttribution] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("CNY");
  const [incurredAt, setIncurredAt] = useState("");
  const [note, setNote] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  // 客户选项（复用 /api/business-partners 只读列表）
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<{ items?: PartnerOption[] } | PartnerOption[]>(
      "/api/business-partners?pageSize=100",
      { signal: controller.signal },
    )
      .then((body) => {
        const list = Array.isArray(body.data) ? body.data : (body.data.items ?? []);
        setCustomers(list);
      })
      .catch(() => {
        // 客户选项加载失败：保存时由服务端兜底校验
      });
    return () => controller.abort();
  }, []);

  // 客户 → 项目级联（复用 /api/projects?customerId= 过滤）
  useEffect(() => {
    if (!values.customerId) {
      setProjects([]);
      return;
    }
    const controller = new AbortController();
    setProjectsLoading(true);
    apiFetch<{ items?: ProjectOption[] } | ProjectOption[]>(
      "/api/projects?customerId=" + encodeURIComponent(values.customerId) + "&pageSize=100",
      { signal: controller.signal },
    )
      .then((body) => {
        const list = Array.isArray(body.data) ? body.data : (body.data.items ?? []);
        setProjects(list);
      })
      .catch(() => setProjects([]))
      .finally(() => {
        if (!controller.signal.aborted) setProjectsLoading(false);
      });
    return () => controller.abort();
  }, [values.customerId]);

  const customerOptions: ReferenceOption[] = useMemo(
    () => customers.map((c) => ({ value: c.id, label: c.name, hint: c.code })),
    [customers],
  );
  const projectOptions: ReferenceOption[] = useMemo(
    () => projects.map((p) => ({ value: p.id, label: p.name, hint: p.code })),
    [projects],
  );

  const handleSave = () => {
    if (submitting) return;
    const projectId = values.projectId;
    const amountNum = Number(amount);
    if (!values.customerId) {
      setError(new ApiClientError(400, "请选择客户", "VALIDATION"));
      return;
    }
    if (!projectId) {
      setError(new ApiClientError(400, "请选择该客户下的项目", "VALIDATION"));
      return;
    }
    if (!category.trim()) {
      setError(new ApiClientError(400, "费用科目为必填项", "VALIDATION"));
      return;
    }
    if (!amount || !Number.isFinite(amountNum) || amountNum < 0) {
      setError(new ApiClientError(400, "请输入有效的非负金额", "VALIDATION"));
      return;
    }
    setSubmitting(true);
    setError(null);
    apiFetch<{ id: string }>("/api/projects/" + projectId + "/expenses", {
      method: "POST",
      body: JSON.stringify({
        category: category.trim(),
        expenseType: expenseType.trim() || null,
        expenseAttribution: expenseAttribution.trim() || null,
        amount: amountNum,
        currency: currency.trim() || "CNY",
        incurredAt: incurredAt ? new Date(incurredAt + "T00:00:00.000Z").toISOString() : null,
        note: note.trim() || null,
      }),
    })
      .then(() => {
        toast.success("报销申请已保存");
        router.push("/expenses");
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  return (
    <EntityFormWorkspace
      title="新建报销申请"
      description="选择客户及其项目，登记费用科目/金额/日期/备注；保存即生成项目费用记录"
      backHref="/expenses"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSave}
      onCancel={() => router.push("/expenses")}
    >
      <Section title="归属（客户 → 项目）">
        <div className="md:col-span-2">
          <DependentSelector
            levels={[
              { key: "customerId", label: "客户 *", options: customerOptions, placeholder: "请选择客户" },
              { key: "projectId", label: "项目 *", options: projectOptions, loading: projectsLoading, placeholder: "请选择该客户的项目" },
            ]}
            values={values}
            onChange={setValues}
          />
          <p className="text-ink-muted mt-1 text-xs">客户归属直接关联项目（Project → BusinessPartner），报销记录挂在项目下。</p>
        </div>
      </Section>
      <Section title="费用信息">
        <FormField label="费用类型">
          <input
            value={expenseType}
            onChange={(e) => setExpenseType(e.target.value)}
            maxLength={50}
            list="expense-type-suggestions"
            placeholder="如：差旅 / 业务招待 / 办公"
            className={inputClass}
          />
          <datalist id="expense-type-suggestions">
            {EXPENSE_TYPE_SUGGESTIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </FormField>
        <FormField label="费用归属">
          <select value={expenseAttribution} onChange={(e) => setExpenseAttribution(e.target.value)} className={inputClass}>
            <option value="">请选择归属</option>
            {EXPENSE_ATTRIBUTION_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="费用科目" required>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            maxLength={100}
            list="expense-category-suggestions"
            placeholder="如：差旅费 / 交通费 / 办公费"
            className={inputClass}
          />
          <datalist id="expense-category-suggestions">
            {CATEGORY_SUGGESTIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </FormField>
        <FormField label="金额" required>
          <input type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="币种">
          <input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={10} className={inputClass} />
        </FormField>
        <FormField label="发生日期">
          <input type="date" value={incurredAt} onChange={(e) => setIncurredAt(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="备注" hint="最多 500 字">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="费用说明（可选）"
            className={inputClass}
          />
        </FormField>
      </Section>
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("project-expense", "create")}>
      <ExpenseCreateForm />
    </PermissionGuard>
  );
}
