"use client";

/**
 * Project Opportunities — 编辑项目机会（F2-4A2 CRM/Project Workspace，CTO #12030）
 *
 * 依据 Contract Card（project-opportunities.md）与 opportunityUpdateSchema 事实：
 * - PATCH 不含 code/customerId → 两项锁定展示（Create 可写 ≠ Edit 可改）
 * - 已转换机会（convertedAt != null）：stage 不允许修改（backend 409；前端镜像：禁用 + 不发送）
 * - 复用 EntityFormWorkspace + dirty guard + version CAS + isVersionConflict；reload 成功后才 clear dirty
 * - Convert（Tier 3 factAction）不在本页，保持 HOLD
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { AppPage, EntityFormWorkspace, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";

interface OpportunityDetail {
  id: string;
  code: string;
  name: string;
  customerId: string;
  stage: string;
  customerInvestment: string | null;
  expectedRevenue: string | null;
  expectedCost: string | null;
  grossProfit: string | null;
  expenseBudget: string | null;
  salesTarget: string | null;
  paymentStatus: string;
  competitors: Array<{ name: string; note?: string }> | null;
  successProbability: string | null;
  ownerId: string | null;
  description: string | null;
  convertedAt: string | null;
  version: number;
  customer?: { id: string; code: string | null; name: string | null; type: string | null } | null;
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

const PAYMENT_OPTIONS = [
  { value: "UNPAID", label: "未回款" },
  { value: "PARTIAL", label: "部分回款" },
  { value: "PAID", label: "已回款" },
  { value: "OVERDUE", label: "逾期" },
];

const inputClass =
  "w-full rounded-md border border-border px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted focus:border-brand-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-ink-muted";

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

function OpportunityEditForm() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState("LEAD");
  const [ownerId, setOwnerId] = useState("");
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
  const [customerLabel, setCustomerLabel] = useState("—");
  const [convertedAt, setConvertedAt] = useState<string | null>(null);

  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  // 加载详情（reloadKey 变化触发重新加载，供 409 后重取最新数据）
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<OpportunityDetail>(`/api/project-opportunities/${id}`, { signal: controller.signal })
      .then((body) => {
        const d = body.data;
        setCode(d.code);
        setName(d.name);
        setStage(d.stage);
        setOwnerId(d.ownerId ?? "");
        setCustomerInvestment(d.customerInvestment ?? "");
        setExpectedRevenue(d.expectedRevenue ?? "");
        setExpectedCost(d.expectedCost ?? "");
        setGrossProfit(d.grossProfit ?? "");
        setExpenseBudget(d.expenseBudget ?? "");
        setSalesTarget(d.salesTarget ?? "");
        setSuccessProbability(d.successProbability ?? "");
        setPaymentStatus(d.paymentStatus);
        setCompetitorsText(
          (d.competitors ?? []).map((c) => (c.note ? `${c.name}|${c.note}` : c.name)).join("\n"),
        );
        setDescription(d.description ?? "");
        setCustomerLabel(d.customer ? `${d.customer.name ?? ""}（${d.customer.code ?? ""}）` : d.customerId);
        setConvertedAt(d.convertedAt);
        setVersion(d.version);
        setLoading(false);
        // 重新加载最新数据后：重置 dirty（409 reload 或首次加载均适用）
        setDirty(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(
          err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"),
        );
        setLoadFailed(true);
        setLoading(false);
      });
    return () => controller.abort();
  }, [id, reloadKey]);

  // 409 VERSION_CONFLICT 后重新加载最新数据（重新 GET → 更新 version → 重置 dirty）
  const handleReload = () => {
    setError(null);
    setLoadFailed(false);
    setLoading(true);
    setReloadKey((k) => k + 1);
  };

  // backend PATCH nullable().optional()：字段不存在 = 不修改；null = 清空现有值。
  // Edit 必须区分「未修改」与「用户主动清空」：blank → null（清空），非 blank → number。
  const numOrNull = (v: string): number | null => {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isNaN(n) ? null : n;
  };

  const handleSave = () => {
    if (submitting) return;
    if (!name.trim()) {
      setError(new ApiClientError(400, "名称为必填项", "VALIDATION"));
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

    // 已转换机会：stage 不允许修改（不发送，backend 也会 409 拦截）
    const payload: Record<string, unknown> = {
      name: name.trim(),
      ownerId: ownerId.trim() || null,
      customerInvestment: numOrNull(customerInvestment),
      expectedRevenue: numOrNull(expectedRevenue),
      expectedCost: numOrNull(expectedCost),
      grossProfit: numOrNull(grossProfit),
      expenseBudget: numOrNull(expenseBudget),
      salesTarget: numOrNull(salesTarget),
      successProbability: numOrNull(successProbability),
      paymentStatus: paymentStatus || undefined,
      competitors: competitors.length > 0 ? competitors : null,
      description: description.trim() || null,
      version,
    };
    if (!convertedAt) {
      payload.stage = stage || undefined;
    }

    apiFetch<{ id: string }>(`/api/project-opportunities/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    })
      .then(() => router.push(`/project-opportunities/${id}`))
      .catch((err: unknown) => {
        setError(
          err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"),
        );
      })
      .finally(() => setSubmitting(false));
  };

  if (loadFailed) {
    return (
      <AppPage>
        <ErrorPanel error={loadError} />
        <Link href={`/project-opportunities/${id}`} className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          返回详情
        </Link>
      </AppPage>
    );
  }

  if (loading) {
    return (
      <AppPage>
        <div className="border-border bg-surface rounded-lg border p-6 text-sm text-ink-muted">
          加载中…
        </div>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <EntityFormWorkspace
        title="编辑项目机会"
        description={convertedAt ? "该机会已转换为项目：阶段锁定，仅可维护商业预测与其他信息" : "编辑项目机会"}
        backHref={`/project-opportunities/${id}`}
        mode="edit"
        submitting={submitting}
        error={error}
        dirty={dirty}
        onDirty={() => setDirty(true)}
        onReload={handleReload}
        onSave={handleSave}
        onCancel={() => router.push(`/project-opportunities/${id}`)}
      >
        <Section title="基本信息">
          <Field label="机会编号" required>
            <input value={code} disabled className={inputClass} />
          </Field>
          <Field label="机会名称" required>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </Field>
          <Field label="客户" required>
            <input value={customerLabel} disabled className={inputClass} />
          </Field>
          <Field label="阶段">
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              disabled={Boolean(convertedAt)}
              className={inputClass}
            >
              {STAGE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="负责人">
            <input value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={inputClass} placeholder="负责人 ID（可选）" />
          </Field>
        </Section>

        <Section title="商业预测">
          <Field label="预计营收">
            <input type="number" value={expectedRevenue} onChange={(e) => setExpectedRevenue(e.target.value)} className={inputClass} />
          </Field>
          <Field label="预计成本">
            <input type="number" value={expectedCost} onChange={(e) => setExpectedCost(e.target.value)} className={inputClass} />
          </Field>
          <Field label="毛利">
            <input type="number" value={grossProfit} onChange={(e) => setGrossProfit(e.target.value)} className={inputClass} />
          </Field>
          <Field label="成功率（%）">
            <input type="number" min={0} max={100} value={successProbability} onChange={(e) => setSuccessProbability(e.target.value)} className={inputClass} />
          </Field>
          <Field label="销售目标">
            <input type="number" value={salesTarget} onChange={(e) => setSalesTarget(e.target.value)} className={inputClass} />
          </Field>
          <Field label="费用预算">
            <input type="number" value={expenseBudget} onChange={(e) => setExpenseBudget(e.target.value)} className={inputClass} />
          </Field>
          <Field label="客户投入">
            <input type="number" value={customerInvestment} onChange={(e) => setCustomerInvestment(e.target.value)} className={inputClass} />
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
          <Field label="竞争对手">
            <textarea
              value={competitorsText}
              onChange={(e) => setCompetitorsText(e.target.value)}
              className={inputClass}
              rows={3}
              placeholder={"每行一个竞争对手，格式：名称 或 名称|备注"}
            />
          </Field>
          <Field label="描述">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputClass}
              rows={3}
              placeholder="机会描述（可选）"
            />
          </Field>
        </Section>
      </EntityFormWorkspace>
    </AppPage>
  );
}

export default function Page() {
  const { state } = useSession();
  const canEdit =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("project-opportunity", "edit"));
  if (!canEdit) {
    return (
      <PermissionGuard permission={actionPermission("project-opportunity", "edit")}>
        <div className="border-border bg-surface rounded-lg border p-6 text-sm text-ink-muted">
          无编辑项目机会权限
        </div>
      </PermissionGuard>
    );
  }
  return (
    <PermissionGuard permission={actionPermission("project-opportunity", "edit")}>
      <OpportunityEditForm />
    </PermissionGuard>
  );
}
