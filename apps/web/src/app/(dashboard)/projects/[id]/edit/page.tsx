"use client";

/**
 * Projects — 编辑项目（F2-4A2 CRM/Project Workspace，CTO #12030）
 *
 * 依据 Contract Card（projects.md）与 projectUpdateSchema 事实（backend PATCH 极窄）：
 * 只允许：name / priority / ownerId / description / progressPercent / projectRating / version
 * 以下必须 readonly：code / customer / opportunity / stage / expectedContractAmount /
 * expectedProfit / expectedGrossMarginRate / paymentStatus
 * stage 绝不能通过 Edit 表单直接修改（只能走 /projects/:id/transition，本轮 HOLD）。
 * closure 可见性不影响结项判断：结项由 stage === "CLOSED" 决定（CTO #12142，无 project-closure:view 时
 * backend 不返回 closure 字段，但 stage 始终返回；backend 结项同事务把 stage 置为 CLOSED，PATCH 返回 409）。
 * 复用 EntityFormWorkspace + dirty guard + version CAS + isVersionConflict；reload 成功后才 clear dirty。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { AppPage, EntityFormWorkspace, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { INPUT_CLASS } from "@/lib/ui-classes";

interface ProjectDetail {
  id: string;
  code: string;
  name: string;
  stage: string;
  priority: string | null;
  progressPercent: string | null;
  projectRating: string | null;
  paymentStatus: string;
  expectedContractAmount: string | null;
  expectedProfit: string | null;
  expectedGrossMarginRate: string | null;
  ownerId: string | null;
  description: string | null;
  version: number;
  customer?: { id: string; code: string | null; name: string | null; type: string | null } | null;
  opportunity?: { id: string; code: string | null; name: string | null; stage: string | null } | null;
  closure?: { id: string; closedAt: string | null; reason: string | null } | null;
}

const PRIORITY_OPTIONS = [
  { value: "HIGH", label: "高" },
  { value: "MEDIUM", label: "中" },
  { value: "LOW", label: "低" },
];

const STAGE_LABELS: Record<string, string> = {
  LEAD: "线索",
  QUALIFIED: "准入",
  SOLUTION: "方案",
  QUOTATION: "报价",
  SAMPLING: "试样",
  TESTING: "测试",
  SMALL_BATCH: "小批量",
  MASS_SUPPLY: "批量供货",
  PAUSED: "暂停",
  FAILED: "失败",
  CLOSED: "结项",
};

const PAYMENT_LABELS: Record<string, string> = {
  UNPAID: "未回款",
  PARTIAL: "部分回款",
  PAID: "已回款",
  OVERDUE: "逾期",
};

const inputClass = INPUT_CLASS;

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

function ProjectEditForm() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();

  const [name, setName] = useState("");
  const [priority, setPriority] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [description, setDescription] = useState("");
  const [progressPercent, setProgressPercent] = useState("");
  const [projectRating, setProjectRating] = useState("");

  // readonly 展示字段（Edit 不可修改）
  const [code, setCode] = useState("");
  const [stage, setStage] = useState("");
  const [customerLabel, setCustomerLabel] = useState("—");
  const [opportunityLabel, setOpportunityLabel] = useState("—");
  const [expectedContractAmount, setExpectedContractAmount] = useState("");
  const [expectedProfit, setExpectedProfit] = useState("");
  const [expectedGrossMarginRate, setExpectedGrossMarginRate] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");

  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);
  const [closed, setClosed] = useState(false);

  // 加载详情（reloadKey 变化触发重新加载，供 409 后重取最新数据）
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<ProjectDetail>(`/api/projects/${id}`, { signal: controller.signal })
      .then((body) => {
        const d = body.data;
        setCode(d.code);
        setName(d.name);
        setStage(d.stage);
        setPriority(d.priority ?? "");
        setOwnerId(d.ownerId ?? "");
        setDescription(d.description ?? "");
        setProgressPercent(d.progressPercent ?? "");
        setProjectRating(d.projectRating ?? "");
        setCustomerLabel(d.customer ? `${d.customer.name ?? ""}（${d.customer.code ?? ""}）` : "—");
        setOpportunityLabel(
          d.opportunity ? `${d.opportunity.code ?? ""} ${d.opportunity.name ?? ""}`.trim() : "—",
        );
        setExpectedContractAmount(d.expectedContractAmount ?? "");
        setExpectedProfit(d.expectedProfit ?? "");
        setExpectedGrossMarginRate(d.expectedGrossMarginRate ?? "");
        setPaymentStatus(d.paymentStatus);
        // CTO #12142：结项判断不依赖 closure 可见性（无 project-closure:view 时 backend 不返回 closure 字段）；
        // 项目正式结项时 backend 同事务把 stage 更新为 CLOSED，stage 始终返回。
        setClosed(d.stage === "CLOSED");
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

  const handleSave = () => {
    if (submitting) return;
    if (!name.trim()) {
      setError(new ApiClientError(400, "名称为必填项", "VALIDATION"));
      return;
    }
    setSubmitting(true);
    setError(null);

    // 只发送 backend PATCH 允许的字段（projectUpdateSchema 极窄）
    const payload: Record<string, unknown> = {
      name: name.trim(),
      priority: priority || null,
      ownerId: ownerId.trim() || null,
      description: description.trim() || null,
      progressPercent:
        progressPercent.trim() === "" ? null : Number(progressPercent),
      projectRating: projectRating.trim() || null,
      version,
    };

    apiFetch<{ id: string }>(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    })
      .then(() => router.push(`/projects/${id}`))
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
        <Link href={`/projects/${id}`} className="mt-3 inline-block text-sm text-brand-600 hover:underline">
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

  // 已结项：backend 对 PATCH 返回 409；前端直接展示锁定面板，不渲染可编辑表单
  if (closed) {
    return (
      <AppPage>
        <div className="border-border bg-surface rounded-lg border p-6">
          <p className="text-sm font-medium text-ink-primary">项目已结项，不可编辑</p>
          <p className="mt-1 text-sm text-ink-muted">结项项目由后端锁定关键字段，PATCH 将返回 409。</p>
          <Link href={`/projects/${id}`} className="mt-3 inline-block text-sm text-brand-600 hover:underline">
            返回详情
          </Link>
        </div>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <EntityFormWorkspace
        title="编辑项目"
        description="仅可编辑基础信息；阶段、客户、金额与回款状态为只读（阶段只能走 Transition）"
        backHref={`/projects/${id}`}
        mode="edit"
        submitting={submitting}
        error={error}
        dirty={dirty}
        onDirty={() => setDirty(true)}
        onReload={handleReload}
        onSave={handleSave}
        onCancel={() => router.push(`/projects/${id}`)}
      >
        <Section title="基本信息">
          <Field label="项目编号" required>
            <input value={code} disabled className={inputClass} />
          </Field>
          <Field label="项目名称" required>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </Field>
          <Field label="客户" required>
            <input value={customerLabel} disabled className={inputClass} />
          </Field>
          <Field label="来源机会">
            <input value={opportunityLabel} disabled className={inputClass} />
          </Field>
          <Field label="阶段">
            <input value={STAGE_LABELS[stage] ?? stage} disabled className={inputClass} />
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
          <Field label="进度（%）">
            <input type="number" min={0} max={100} value={progressPercent} onChange={(e) => setProgressPercent(e.target.value)} className={inputClass} />
          </Field>
          <Field label="项目评级">
            <input value={projectRating} onChange={(e) => setProjectRating(e.target.value)} className={inputClass} placeholder="项目评级（可选）" />
          </Field>
        </Section>

        <Section title="商务字段（只读，Edit 不可修改）">
          <Field label="预计合同金额">
            <input value={expectedContractAmount} disabled className={inputClass} />
          </Field>
          <Field label="预计利润">
            <input value={expectedProfit} disabled className={inputClass} />
          </Field>
          <Field label="预计毛利率（%）">
            <input value={expectedGrossMarginRate} disabled className={inputClass} />
          </Field>
          <Field label="回款状态">
            <input value={PAYMENT_LABELS[paymentStatus] ?? paymentStatus} disabled className={inputClass} />
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
  const canEdit =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("project", "edit"));
  if (!canEdit) {
    return (
      <PermissionGuard permission={actionPermission("project", "edit")}>
        <div className="border-border bg-surface rounded-lg border p-6 text-sm text-ink-muted">
          无编辑项目权限
        </div>
      </PermissionGuard>
    );
  }
  return (
    <PermissionGuard permission={actionPermission("project", "edit")}>
      <ProjectEditForm />
    </PermissionGuard>
  );
}
