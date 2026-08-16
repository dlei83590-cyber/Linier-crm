"use client";

/**
 * Projects — 新建项目（F2-4A2 CRM/Project Workspace，CTO #12030）
 *
 * 依据 Contract Card（projects.md）与 projectCreateSchema 事实：
 * code/name/customerId 必填；stage 默认 SAMPLING；priority/ownerId/description/
 * expectedContractAmount/expectedProfit/expectedGrossMarginRate/paymentStatus 可选。
 * 纪律：Project Create 是独立项目创建，**不模拟 Opportunity → Project conversion**
 * （唯一正确入口是 /project-opportunities/:id/convert，Tier 3 本轮 HOLD，不在本页）。
 * Customer 使用 /api/customers authoritative selector；Create 成功只消费服务端返回 id → 跳 Detail。
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { AppPage, EntityFormWorkspace, ReferenceSelector } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";

interface CustomerOption {
  id: string;
  code: string | null;
  name: string | null;
}

const STAGE_OPTIONS = [
  { value: "LEAD", label: "线索" },
  { value: "QUALIFIED", label: "准入" },
  { value: "SOLUTION", label: "方案" },
  { value: "QUOTATION", label: "报价" },
  { value: "SAMPLING", label: "试样" },
  { value: "TESTING", label: "测试" },
  { value: "SMALL_BATCH", label: "小批量" },
  { value: "MASS_SUPPLY", label: "批量供货" },
  { value: "PAUSED", label: "暂停" },
  { value: "FAILED", label: "失败" },
  { value: "CLOSED", label: "结项" },
];

const PRIORITY_OPTIONS = [
  { value: "HIGH", label: "高" },
  { value: "MEDIUM", label: "中" },
  { value: "LOW", label: "低" },
];

const PAYMENT_OPTIONS = [
  { value: "UNPAID", label: "未回款" },
  { value: "PARTIAL", label: "部分回款" },
  { value: "PAID", label: "已回款" },
  { value: "OVERDUE", label: "逾期" },
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

function ProjectCreateForm() {
  const router = useRouter();
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [selectorsLoading, setSelectorsLoading] = useState(true);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [stage, setStage] = useState("SAMPLING");
  const [priority, setPriority] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [description, setDescription] = useState("");
  const [expectedContractAmount, setExpectedContractAmount] = useState("");
  const [expectedProfit, setExpectedProfit] = useState("");
  const [expectedGrossMarginRate, setExpectedGrossMarginRate] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("UNPAID");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  // Customer selector 数据源（GET FINAL）
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<CustomerOption[]>("/api/customers?pageSize=100", { signal: controller.signal })
      .then((body) => {
        setCustomers(body.data);
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

    const payload: Record<string, unknown> = {
      code: code.trim(),
      name: name.trim(),
      customerId,
      stage: stage || undefined,
      priority: priority || null,
      ownerId: ownerId.trim() || null,
      description: description.trim() || null,
      expectedContractAmount: numOrUndefined(expectedContractAmount),
      expectedProfit: numOrUndefined(expectedProfit),
      expectedGrossMarginRate: numOrUndefined(expectedGrossMarginRate),
      paymentStatus: paymentStatus || undefined,
    };

    apiFetch<{ id: string }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(payload),
    })
      .then((body) => {
        router.push(`/projects/${body.data.id}`);
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
        title="新建项目"
        description="独立项目创建（如需从机会转项目，请走机会详情 Convert，本页不模拟转换）"
        backHref="/projects"
        mode="create"
        submitting={submitting}
        error={error}
        dirty={dirty}
        onDirty={() => setDirty(true)}
        onSave={handleSave}
        onCancel={() => router.push("/projects")}
      >
        <Section title="基本信息">
          <Field label="项目编号" required>
            <input value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} placeholder="如 PRJ-2026-0001" />
          </Field>
          <Field label="项目名称" required>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="项目名称" />
          </Field>
          <Field label="客户" required>
            <ReferenceSelector
              value={customerId}
              onChange={setCustomerId}
              options={customers.map((c) => ({ value: c.id, label: c.name ?? "", hint: c.code ?? undefined }))}
              loading={selectorsLoading}
              placeholder="请选择客户"
              required
            />
          </Field>
          <Field label="阶段">
            <select value={stage} onChange={(e) => setStage(e.target.value)} className={inputClass}>
              {STAGE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="优先级">
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputClass}>
              <option value="">请选择</option>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="负责人">
            <input value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={inputClass} placeholder="负责人 ID（可选）" />
          </Field>
        </Section>

        <Section title="商务预测">
          <Field label="预计合同金额">
            <input type="number" value={expectedContractAmount} onChange={(e) => setExpectedContractAmount(e.target.value)} className={inputClass} placeholder="0.00" />
          </Field>
          <Field label="预计利润">
            <input type="number" value={expectedProfit} onChange={(e) => setExpectedProfit(e.target.value)} className={inputClass} placeholder="0.00" />
          </Field>
          <Field label="预计毛利率（%）">
            <input type="number" min={0} max={100} value={expectedGrossMarginRate} onChange={(e) => setExpectedGrossMarginRate(e.target.value)} className={inputClass} placeholder="0-100" />
          </Field>
          <Field label="回款状态">
            <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} className={inputClass}>
              {PAYMENT_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
        </Section>

        <Section title="其他">
          <Field label="描述">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputClass}
              rows={3}
              placeholder="项目描述（可选）"
            />
          </Field>
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
    hasPermission(state.user.roles as RoleCode[], actionPermission("project", "create"));
  if (!canCreate) {
    return (
      <PermissionGuard permission={actionPermission("project", "create")}>
        <div className="border-border bg-surface rounded-lg border p-6 text-sm text-ink-muted">
          无新建项目权限
        </div>
      </PermissionGuard>
    );
  }
  return (
    <PermissionGuard permission={actionPermission("project", "create")}>
      <ProjectCreateForm />
    </PermissionGuard>
  );
}
