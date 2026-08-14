"use client";

/**
 * Projects — 项目管理详情页（F2-4B1 Project Read Workspace Tabs，CTO #12097）
 *
 * F2-4A2 FINAL APPROVED 99/100 → F2-4A CLOSED → F2-4B1 START。
 * 只读 Tabs，全部消费 aggregate GET /api/projects/:id 已返回的子资源事实
 * （stakeholders/members/milestones/tasks/products/risks/visits/budgets/expenses/progresses/acceptances/closure/tags）。
 * 纪律：
 * - attachments 未被 aggregate GET 返回 → 不开放 Attachments Tab（不前端拼装）
 * - B1 严格只读；任何子资源 Add/Edit/Delete 留 B2（必须逐路由核 POST/PATCH contract 后才开放）
 * - transition/close/acceptance（Tier 3 factActions）保持 HOLD
 * - Project Risks/Visits/Milestones/Tasks 不重开为 Sidebar 平级模块（归属本 Workspace Tabs）
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import {
  AppPage,
  EntityDetailWorkspace,
  StatusBadge,
  ErrorPanel,
  ConfirmActionDialog,
  ProjectSubresourceDialog,
} from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import {
  StakeholderFields,
  MemberFields,
  EMPTY_STAKEHOLDER_FORM,
  EMPTY_MEMBER_FORM,
  type StakeholderFormValue,
  type MemberFormValue,
} from "./subresource-fields";

interface ProjectDetail {
  id: string;
  code: string;
  name: string;
  stage: string;
  priority: string | null;
  progressPercent: string | null;
  paymentStatus: string;
  expectedContractAmount: string | null;
  expectedProfit: string | null;
  expectedGrossMarginRate: string | null;
  receivedAmount: string | null;
  receivableBalance: string | null;
  ownerId: string | null;
  projectRating: string | null;
  description: string | null;
  createdAt: string;
  customer?: { id: string; code: string | null; name: string | null; type: string | null } | null;
  opportunity?: { id: string; code: string | null; name: string | null; stage: string | null } | null;
  closure?: { id: string; closedAt: string | null; reason: string | null } | null;
  stakeholders?: Array<{
    id: string;
    version: number;
    role: string;
    name: string;
    title?: string | null;
    department?: string | null;
    phone?: string | null;
    email?: string | null;
    note?: string | null;
  }>;
  members?: Array<{
    id: string;
    version: number;
    name: string;
    roleInProject?: string | null;
    joinedAt?: string | null;
    leftAt?: string | null;
  }>;
  milestones?: Array<{
    id: string;
    version: number;
    name: string;
    status: string;
    plannedDate?: string | null;
    actualDate?: string | null;
    deliverable?: string | null;
    delayReason?: string | null;
  }>;
  tasks?: Array<{
    id: string;
    version: number;
    name: string;
    status: string;
    priority?: string | null;
    dueDate?: string | null;
  }>;
  products?: Array<{
    id: string;
    quantity?: string | null;
    unitPrice?: string | null;
    note?: string | null;
    item?: { id: string; code: string | null; name: string | null; model: string | null } | null;
  }>;
  risks?: Array<{
    id: string;
    description: string;
    status: string;
    probability?: string | null;
    impact?: string | null;
    mitigation?: string | null;
  }>;
  visits?: Array<{
    id: string;
    visitType: string;
    visitedAt: string;
    contactName?: string | null;
    summary?: string | null;
    nextAction?: string | null;
  }>;
  budgets?: Array<{
    id: string;
    category: string;
    amount: string;
    currency: string;
    note?: string | null;
  }>;
  expenses?: Array<{
    id: string;
    category: string;
    amount: string;
    currency: string;
    incurredAt?: string | null;
    note?: string | null;
  }>;
  progresses?: Array<{
    id: string;
    recordedAt: string;
    progressPercent: string;
    summary: string;
  }>;
  acceptances?: Array<{
    id: string;
    name: string;
    expectedDate?: string | null;
    actualDate?: string | null;
    result: string;
    resultNote?: string | null;
  }>;
  tags?: Array<{
    id: string;
    tag?: { id: string; code: string | null; name: string | null; color: string | null } | null;
  }>;
  /** 子资源读权限能力投影（backend aggregate read permission hardening，CTO #12122/#12142） */
  capabilities: {
    stakeholders: boolean;
    members: boolean;
    milestones: boolean;
    tasks: boolean;
    budgets: boolean;
    expenses: boolean;
    products: boolean;
    risks: boolean;
    visits: boolean;
    progresses: boolean;
    acceptances: boolean;
    closure: boolean;
    tags: boolean;
  };
}

/** B2-1A：子资源 row 类型（aggregate GET 返回完整 Prisma row，含 version 供 PATCH CAS） */
type StakeholderRow = NonNullable<ProjectDetail["stakeholders"]>[number];
type MemberRow = NonNullable<ProjectDetail["members"]>[number];

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

const STAGE_TONE_MAP: Record<string, "success" | "neutral" | "warning" | "danger" | "info"> = {
  LEAD: "neutral",
  QUALIFIED: "info",
  SOLUTION: "info",
  QUOTATION: "warning",
  SAMPLING: "neutral",
  TESTING: "warning",
  SMALL_BATCH: "warning",
  MASS_SUPPLY: "success",
  PAUSED: "warning",
  FAILED: "danger",
  CLOSED: "neutral",
};

const PRIORITY_LABELS: Record<string, string> = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
};

const PAYMENT_LABELS: Record<string, string> = {
  UNPAID: "未回款",
  PARTIAL: "部分回款",
  PAID: "已回款",
  OVERDUE: "逾期",
};

const TASK_STATUS_LABELS: Record<string, string> = {
  TODO: "待办",
  IN_PROGRESS: "进行中",
  DONE: "已完成",
  CANCELLED: "已取消",
};

const RISK_STATUS_LABELS: Record<string, string> = {
  OPEN: "开启",
  MITIGATING: "应对中",
  CLOSED: "已关闭",
};

const MILESTONE_STATUS_LABELS: Record<string, string> = {
  PLANNED: "计划中",
  IN_PROGRESS: "进行中",
  COMPLETED: "已完成",
  DELAYED: "已延期",
};

const STAKEHOLDER_ROLE_LABELS: Record<string, string> = {
  REQUESTER: "需求人",
  TECHNICAL: "技术人",
  PURCHASER: "采购人",
  DECISION_MAKER: "决策人",
  END_USER: "使用人",
};

const VISIT_TYPE_LABELS: Record<string, string> = {
  VISIT: "走访",
  PHONE: "电话",
  VIDEO: "视频",
  MEETING: "会议",
  OTHER: "其他",
};

const ACCEPTANCE_RESULT_LABELS: Record<string, string> = {
  PASSED: "通过",
  CONDITIONAL_PASS: "有条件通过",
  FAILED: "不通过",
  PENDING: "待验收",
};

const ACCEPTANCE_TONE_MAP: Record<string, "success" | "neutral" | "warning" | "danger" | "info"> = {
  PASSED: "success",
  CONDITIONAL_PASS: "warning",
  FAILED: "danger",
  PENDING: "neutral",
};

type TabKey =
  | "overview"
  | "stakeholders"
  | "members"
  | "milestones"
  | "tasks"
  | "products"
  | "risks"
  | "visits"
  | "financial"
  | "acceptance"
  | "tags";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "概览" },
  { key: "stakeholders", label: "关系人" },
  { key: "members", label: "成员" },
  { key: "milestones", label: "里程碑" },
  { key: "tasks", label: "任务" },
  { key: "products", label: "产品" },
  { key: "risks", label: "风险" },
  { key: "visits", label: "走访" },
  { key: "financial", label: "财务与进度" },
  { key: "acceptance", label: "验收与结项" },
  { key: "tags", label: "标签" },
];

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-ink-primary mb-3 text-sm font-semibold">{children}</h2>;
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="divide-border min-w-full divide-y text-sm">
        <thead className="bg-slate-50 text-left text-xs font-medium text-ink-secondary">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-border divide-y">{children}</tbody>
      </table>
    </div>
  );
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-6 text-center text-sm text-ink-muted">
        {text}
      </td>
    </tr>
  );
}

function ProjectDetailPage() {
  const { state } = useSession();
  const roles =
    state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canEdit =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(roles, actionPermission("project", "edit"));
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [refreshError, setRefreshError] = useState<ApiClientError | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  // B2-1A dialog 状态（资源 + mode + id + authoritative version 分离；表单 state 各自独立）
  const [stakeholderDialog, setStakeholderDialog] = useState<{
    open: boolean;
    mode: "create" | "edit";
    id: string | null;
    version: number | null;
  }>({ open: false, mode: "create", id: null, version: null });
  const [memberDialog, setMemberDialog] = useState<{
    open: boolean;
    mode: "create" | "edit";
    id: string | null;
    version: number | null;
  }>({ open: false, mode: "create", id: null, version: null });
  const [stakeholderForm, setStakeholderForm] =
    useState<StakeholderFormValue>(EMPTY_STAKEHOLDER_FORM);
  const [memberForm, setMemberForm] = useState<MemberFormValue>(EMPTY_MEMBER_FORM);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState<ApiClientError | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    resource: "stakeholder" | "member";
    id: string;
    name: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadProject = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      const body = await apiFetch<ProjectDetail>(`/api/projects/${id}`, signal ? { signal } : undefined);
      setDetail(body.data);
      setError(null);
      setRefreshError(null);
    },
    [id],
  );

  useEffect(() => {
    const controller = new AbortController();
    setInitialLoading(true);
    loadProject(controller.signal)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setInitialLoading(false);
      });
    return () => controller.abort();
  }, [loadProject]);

  // mutation 成功后 background refresh：保留已显示数据，不整页 loading；失败显示 refreshError
  const reloadProject = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadProject();
    } catch (err) {
      const apiErr =
        err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR");
      setRefreshError(apiErr);
    } finally {
      setRefreshing(false);
    }
  }, [loadProject]);

  const openStakeholderCreate = () => {
    setStakeholderForm(EMPTY_STAKEHOLDER_FORM);
    setDialogError(null);
    setStakeholderDialog({ open: true, mode: "create", id: null, version: null });
  };
  const openStakeholderEdit = (s: StakeholderRow) => {
    setStakeholderForm({
      role: s.role,
      name: s.name,
      title: s.title ?? "",
      department: s.department ?? "",
      phone: s.phone ?? "",
      email: s.email ?? "",
      note: s.note ?? "",
    });
    setDialogError(null);
    setStakeholderDialog({ open: true, mode: "edit", id: s.id, version: s.version });
  };
  const closeStakeholderDialog = () =>
    setStakeholderDialog({ open: false, mode: "create", id: null, version: null });

  const openMemberCreate = () => {
    setMemberForm(EMPTY_MEMBER_FORM);
    setDialogError(null);
    setMemberDialog({ open: true, mode: "create", id: null, version: null });
  };
  const openMemberEdit = (m: MemberRow) => {
    setMemberForm({
      name: m.name,
      roleInProject: m.roleInProject ?? "",
      joinedAt: m.joinedAt ? m.joinedAt.slice(0, 10) : "",
      leftAt: m.leftAt ? m.leftAt.slice(0, 10) : "",
    });
    setDialogError(null);
    setMemberDialog({ open: true, mode: "edit", id: m.id, version: m.version });
  };
  const closeMemberDialog = () =>
    setMemberDialog({ open: false, mode: "create", id: null, version: null });

  const submitStakeholder = async () => {
    if (!stakeholderDialog.open) return;
    setSaving(true);
    setDialogError(null);
    try {
      const payload = {
        role: stakeholderForm.role,
        name: stakeholderForm.name,
        title: stakeholderForm.title === "" ? null : stakeholderForm.title,
        department: stakeholderForm.department === "" ? null : stakeholderForm.department,
        phone: stakeholderForm.phone === "" ? null : stakeholderForm.phone,
        email: stakeholderForm.email === "" ? null : stakeholderForm.email,
        note: stakeholderForm.note === "" ? null : stakeholderForm.note,
      };
      if (stakeholderDialog.mode === "create") {
        await apiFetch(`/api/projects/${id}/stakeholders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else if (stakeholderDialog.id && stakeholderDialog.version != null) {
        await apiFetch(`/api/projects/${id}/stakeholders/${stakeholderDialog.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, version: stakeholderDialog.version }),
        });
      }
      closeStakeholderDialog();
      await reloadProject();
    } catch (err) {
      setDialogError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "保存失败", "NETWORK_ERROR"),
      );
    } finally {
      setSaving(false);
    }
  };

  // CAS stale reload：单资源 GET → 只覆盖 form + authoritative version + 清 stale error；不自动 PATCH
  const reloadStakeholder = async () => {
    if (!stakeholderDialog.open || !stakeholderDialog.id) return;
    setSaving(true);
    try {
      const body = await apiFetch<StakeholderRow>(
        `/api/projects/${id}/stakeholders/${stakeholderDialog.id}`,
      );
      const s = body.data;
      setStakeholderForm({
        role: s.role,
        name: s.name,
        title: s.title ?? "",
        department: s.department ?? "",
        phone: s.phone ?? "",
        email: s.email ?? "",
        note: s.note ?? "",
      });
      setStakeholderDialog({ open: true, mode: "edit", id: s.id, version: s.version });
      setDialogError(null);
    } catch (err) {
      setDialogError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "重新加载失败", "NETWORK_ERROR"),
      );
    } finally {
      setSaving(false);
    }
  };

  const submitMember = async () => {
    if (!memberDialog.open) return;
    setSaving(true);
    setDialogError(null);
    try {
      const toIso = (v: string): string | null =>
        v === "" ? null : new Date(`${v}T00:00:00.000Z`).toISOString();
      const payload = {
        name: memberForm.name,
        roleInProject: memberForm.roleInProject === "" ? null : memberForm.roleInProject,
        joinedAt: toIso(memberForm.joinedAt),
        leftAt: toIso(memberForm.leftAt),
      };
      // UI 不暴露 userId：Edit payload 不发送 userId → 保留旧关联（CTO #12368）
      if (memberDialog.mode === "create") {
        await apiFetch(`/api/projects/${id}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else if (memberDialog.id && memberDialog.version != null) {
        await apiFetch(`/api/projects/${id}/members/${memberDialog.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, version: memberDialog.version }),
        });
      }
      closeMemberDialog();
      await reloadProject();
    } catch (err) {
      setDialogError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "保存失败", "NETWORK_ERROR"),
      );
    } finally {
      setSaving(false);
    }
  };

  const reloadMember = async () => {
    if (!memberDialog.open || !memberDialog.id) return;
    setSaving(true);
    try {
      const body = await apiFetch<MemberRow>(`/api/projects/${id}/members/${memberDialog.id}`);
      const m = body.data;
      setMemberForm({
        name: m.name,
        roleInProject: m.roleInProject ?? "",
        joinedAt: m.joinedAt ? m.joinedAt.slice(0, 10) : "",
        leftAt: m.leftAt ? m.leftAt.slice(0, 10) : "",
      });
      setMemberDialog({ open: true, mode: "edit", id: m.id, version: m.version });
      setDialogError(null);
    } catch (err) {
      setDialogError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "重新加载失败", "NETWORK_ERROR"),
      );
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget.resource === "stakeholder") {
        await apiFetch(`/api/projects/${id}/stakeholders/${deleteTarget.id}`, { method: "DELETE" });
      } else {
        await apiFetch(`/api/projects/${id}/members/${deleteTarget.id}`, { method: "DELETE" });
      }
      setDeleteTarget(null);
      await reloadProject();
    } catch (err) {
      setDeleteTarget(null);
      setError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "删除失败", "NETWORK_ERROR"),
      );
    } finally {
      setDeleting(false);
    }
  };

  if (initialLoading) {
    return (
      <AppPage>
        <div className="border-border bg-surface rounded-lg border p-6 text-sm text-ink-muted">
          加载中…
        </div>
      </AppPage>
    );
  }

  if (error || !detail) {
    return (
      <AppPage>
        <ErrorPanel error={error} />
        <Link href="/projects" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          返回列表
        </Link>
      </AppPage>
    );
  }

  // B2-1A 三层按钮 Gate：capabilities + 细粒度 permission + stage !== CLOSED（不复用项目级 canEdit，CTO #12350/#12401）
  const canManageStakeholders = detail.capabilities.stakeholders;
  const canAddStakeholder =
    canManageStakeholders &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-stakeholder", "create"));
  const canEditStakeholder =
    canManageStakeholders &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-stakeholder", "edit"));
  const canDeleteStakeholder =
    canManageStakeholders &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-stakeholder", "delete"));
  const canManageMembers = detail.capabilities.members;
  const canAddMember =
    canManageMembers &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-member", "create"));
  const canEditMember =
    canManageMembers &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-member", "edit"));
  const canDeleteMember =
    canManageMembers &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-member", "delete"));

  return (
    <AppPage>
      {refreshError && (
        <div className="border-amber-200 mb-4 rounded-md border bg-amber-50 p-3 text-sm text-amber-700">
          <p>
            刷新失败（已保留当前数据）：{refreshError.message}
            {refreshError.code ? `（${refreshError.code}）` : ""}
          </p>
        </div>
      )}
      <EntityDetailWorkspace
        title={`项目管理详情 — ${detail.code}`}
        backHref="/projects"
        status={detail.stage}
        statusLabel={STAGE_LABELS[detail.stage] ?? detail.stage}
        statusTone={STAGE_TONE_MAP[detail.stage] ?? "neutral"}
        actions={
          canEdit && detail.stage !== "CLOSED" ? (
            <Link
              href={`/projects/${id}/edit`}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              编辑
            </Link>
          ) : undefined
        }
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="项目编号" value={detail.code} />
            <InfoItem label="项目名称" value={detail.name} />
            <InfoItem label="客户" value={detail.customer?.name} />
            <InfoItem
              label="来源机会"
              value={
                detail.opportunity
                  ? `${detail.opportunity.code ?? ""} ${detail.opportunity.name ?? ""}`.trim()
                  : null
              }
            />
            <InfoItem
              label="优先级"
              value={detail.priority ? PRIORITY_LABELS[detail.priority] ?? detail.priority : null}
            />
            <InfoItem
              label="进度"
              value={detail.progressPercent != null ? `${detail.progressPercent}%` : null}
            />
            <InfoItem
              label="回款状态"
              value={PAYMENT_LABELS[detail.paymentStatus] ?? detail.paymentStatus}
            />
            <InfoItem label="预计合同金额" value={detail.expectedContractAmount} />
            <InfoItem label="预计利润" value={detail.expectedProfit} />
            <InfoItem
              label="预计毛利率"
              value={detail.expectedGrossMarginRate != null ? `${detail.expectedGrossMarginRate}%` : null}
            />
            <InfoItem label="已回款金额" value={detail.receivedAmount} />
            <InfoItem label="应收余额" value={detail.receivableBalance} />
            <InfoItem label="负责人" value={detail.ownerId} />
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
            <InfoItem
              label="结项"
              value={
                detail.closure
                  ? `${detail.closure.reason ?? "已结项"}（${formatDate(detail.closure.closedAt)}）`
                  : null
              }
            />
          </div>
        }
      >
        {/* Tabs 导航（F2-4B1 capability-aware：capability=false 的 Tab 不出现；组合 Tab 按 OR） */}
        <div className="border-border flex flex-wrap gap-1 border-b">
          {TABS.filter((t) => {
            if (t.key === "overview") return true; // 核心事实始终可见
            if (t.key === "financial") return detail.capabilities.budgets || detail.capabilities.expenses || detail.capabilities.progresses;
            if (t.key === "acceptance") return detail.capabilities.acceptances || detail.capabilities.closure;
            return detail.capabilities[t.key]; // 单资源 Tab：capability=false → 不出现
          }).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={`rounded-t-md px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === t.key
                  ? "border-brand-600 text-brand-700 border-b-2"
                  : "text-ink-secondary hover:bg-slate-50 hover:text-ink-primary"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="space-y-6 pt-4">
          {activeTab === "overview" && (
            <div className="space-y-6">
              <section className="border-border rounded-md border p-4">
                <SectionTitle>项目描述</SectionTitle>
                <p className="text-sm whitespace-pre-wrap text-ink-secondary">
                  {detail.description ?? "暂无描述"}
                </p>
              </section>
              <section className="border-border rounded-md border p-4">
                <SectionTitle>商务信息</SectionTitle>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <InfoItem label="预计合同金额" value={detail.expectedContractAmount} />
                  <InfoItem label="预计利润" value={detail.expectedProfit} />
                  <InfoItem
                    label="预计毛利率"
                    value={detail.expectedGrossMarginRate != null ? `${detail.expectedGrossMarginRate}%` : null}
                  />
                  <InfoItem label="已回款金额" value={detail.receivedAmount} />
                  <InfoItem label="应收余额" value={detail.receivableBalance} />
                  <InfoItem
                    label="回款状态"
                    value={PAYMENT_LABELS[detail.paymentStatus] ?? detail.paymentStatus}
                  />
                  <InfoItem label="项目评级" value={detail.projectRating} />
                  <InfoItem
                    label="汇总进度"
                    value={detail.progressPercent != null ? `${detail.progressPercent}%` : null}
                  />
                </div>
              </section>
            </div>
          )}

          {activeTab === "stakeholders" && (
            <section className="border-border rounded-md border p-4">
              <div className="mb-3 flex items-center justify-between">
                <SectionTitle>项目关系人（{detail.stakeholders?.length ?? 0}）</SectionTitle>
                {canAddStakeholder && (
                  <button
                    type="button"
                    onClick={openStakeholderCreate}
                    className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    添加关系人
                  </button>
                )}
              </div>
              <Table
                headers={[
                  "角色",
                  "姓名",
                  "职务",
                  "部门",
                  "电话",
                  "邮箱",
                  "备注",
                  ...(canEditStakeholder || canDeleteStakeholder ? ["操作"] : []),
                ]}
              >
                {(detail.stakeholders ?? []).map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2 text-ink-secondary">
                      {STAKEHOLDER_ROLE_LABELS[s.role] ?? s.role}
                    </td>
                    <td className="px-3 py-2 text-ink-primary">{s.name}</td>
                    <td className="px-3 py-2 text-ink-secondary">{s.title ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{s.department ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{s.phone ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{s.email ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{s.note ?? "—"}</td>
                    {(canEditStakeholder || canDeleteStakeholder) && (
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          {canEditStakeholder && (
                            <button
                              type="button"
                              onClick={() => openStakeholderEdit(s)}
                              className="text-brand-600 text-sm hover:underline"
                            >
                              编辑
                            </button>
                          )}
                          {canDeleteStakeholder && (
                            <button
                              type="button"
                              onClick={() =>
                                setDeleteTarget({ resource: "stakeholder", id: s.id, name: s.name })
                              }
                              className="text-sm text-red-600 hover:underline"
                            >
                              删除
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {(detail.stakeholders ?? []).length === 0 && (
                  <EmptyRow colSpan={canEditStakeholder || canDeleteStakeholder ? 8 : 7} text="暂无关系人" />
                )}
              </Table>
            </section>
          )}

          {activeTab === "members" && (
            <section className="border-border rounded-md border p-4">
              <div className="mb-3 flex items-center justify-between">
                <SectionTitle>项目成员（{detail.members?.length ?? 0}）</SectionTitle>
                {canAddMember && (
                  <button
                    type="button"
                    onClick={openMemberCreate}
                    className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    添加成员
                  </button>
                )}
              </div>
              <Table
                headers={[
                  "姓名",
                  "项目内角色",
                  "加入时间",
                  "离开时间",
                  ...(canEditMember || canDeleteMember ? ["操作"] : []),
                ]}
              >
                {(detail.members ?? []).map((m) => (
                  <tr key={m.id}>
                    <td className="px-3 py-2 text-ink-primary">{m.name}</td>
                    <td className="px-3 py-2 text-ink-secondary">{m.roleInProject ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{formatDate(m.joinedAt)}</td>
                    <td className="px-3 py-2 text-ink-secondary">{formatDate(m.leftAt)}</td>
                    {(canEditMember || canDeleteMember) && (
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          {canEditMember && (
                            <button
                              type="button"
                              onClick={() => openMemberEdit(m)}
                              className="text-brand-600 text-sm hover:underline"
                            >
                              编辑
                            </button>
                          )}
                          {canDeleteMember && (
                            <button
                              type="button"
                              onClick={() =>
                                setDeleteTarget({ resource: "member", id: m.id, name: m.name })
                              }
                              className="text-sm text-red-600 hover:underline"
                            >
                              删除
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {(detail.members ?? []).length === 0 && (
                  <EmptyRow colSpan={canEditMember || canDeleteMember ? 5 : 4} text="暂无成员" />
                )}
              </Table>
            </section>
          )}

          {activeTab === "milestones" && (
            <section className="border-border rounded-md border p-4">
              <SectionTitle>里程碑（{detail.milestones?.length ?? 0}）</SectionTitle>
              <Table headers={["名称", "状态", "计划日期", "实际日期", "交付成果", "延期原因"]}>
                {(detail.milestones ?? []).map((m) => (
                  <tr key={m.id}>
                    <td className="px-3 py-2 text-ink-primary">{m.name}</td>
                    <td className="px-3 py-2">
                      <StatusBadge
                        status={m.status}
                        label={MILESTONE_STATUS_LABELS[m.status] ?? m.status}
                      />
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{formatDate(m.plannedDate)}</td>
                    <td className="px-3 py-2 text-ink-secondary">{formatDate(m.actualDate)}</td>
                    <td className="px-3 py-2 text-ink-secondary">{m.deliverable ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{m.delayReason ?? "—"}</td>
                  </tr>
                ))}
                {(detail.milestones ?? []).length === 0 && (
                  <EmptyRow colSpan={6} text="暂无里程碑" />
                )}
              </Table>
            </section>
          )}

          {activeTab === "tasks" && (
            <section className="border-border rounded-md border p-4">
              <SectionTitle>任务（{detail.tasks?.length ?? 0}）</SectionTitle>
              <Table headers={["名称", "状态", "优先级", "截止日期"]}>
                {(detail.tasks ?? []).map((t) => (
                  <tr key={t.id}>
                    <td className="px-3 py-2 text-ink-primary">{t.name}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={t.status} label={TASK_STATUS_LABELS[t.status] ?? t.status} />
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">
                      {t.priority ? PRIORITY_LABELS[t.priority] ?? t.priority : "—"}
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{formatDate(t.dueDate)}</td>
                  </tr>
                ))}
                {(detail.tasks ?? []).length === 0 && <EmptyRow colSpan={4} text="暂无任务" />}
              </Table>
            </section>
          )}

          {activeTab === "products" && (
            <section className="border-border rounded-md border p-4">
              <SectionTitle>产品（{detail.products?.length ?? 0}）</SectionTitle>
              <Table headers={["物料编码", "物料名称", "型号", "数量", "单价", "备注"]}>
                {(detail.products ?? []).map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2 text-ink-secondary">{p.item?.code ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-primary">{p.item?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{p.item?.model ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-primary">{p.quantity ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{p.unitPrice ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{p.note ?? "—"}</td>
                  </tr>
                ))}
                {(detail.products ?? []).length === 0 && <EmptyRow colSpan={6} text="暂无产品" />}
              </Table>
            </section>
          )}

          {activeTab === "risks" && (
            <section className="border-border rounded-md border p-4">
              <SectionTitle>风险（{detail.risks?.length ?? 0}）</SectionTitle>
              <Table headers={["描述", "状态", "概率", "影响", "应对方案"]}>
                {(detail.risks ?? []).map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 text-ink-primary">{r.description}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} label={RISK_STATUS_LABELS[r.status] ?? r.status} />
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{r.probability ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{r.impact ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{r.mitigation ?? "—"}</td>
                  </tr>
                ))}
                {(detail.risks ?? []).length === 0 && <EmptyRow colSpan={5} text="暂无风险" />}
              </Table>
            </section>
          )}

          {activeTab === "visits" && (
            <section className="border-border rounded-md border p-4">
              <SectionTitle>走访（{detail.visits?.length ?? 0}）</SectionTitle>
              <Table headers={["类型", "走访时间", "客户联系人", "沟通纪要", "下次行动"]}>
                {(detail.visits ?? []).map((v) => (
                  <tr key={v.id}>
                    <td className="px-3 py-2 text-ink-secondary">
                      {VISIT_TYPE_LABELS[v.visitType] ?? v.visitType}
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{formatDate(v.visitedAt)}</td>
                    <td className="px-3 py-2 text-ink-secondary">{v.contactName ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{v.summary ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{v.nextAction ?? "—"}</td>
                  </tr>
                ))}
                {(detail.visits ?? []).length === 0 && <EmptyRow colSpan={5} text="暂无走访记录" />}
              </Table>
            </section>
          )}

          {activeTab === "financial" && (
            <div className="space-y-6">
              {detail.capabilities.budgets && (
                <section className="border-border rounded-md border p-4">
                  <SectionTitle>预算（{detail.budgets?.length ?? 0}）</SectionTitle>
                  <Table headers={["科目", "金额", "币种", "备注"]}>
                    {(detail.budgets ?? []).map((b) => (
                      <tr key={b.id}>
                        <td className="px-3 py-2 text-ink-primary">{b.category}</td>
                        <td className="px-3 py-2 text-ink-primary">{b.amount}</td>
                        <td className="px-3 py-2 text-ink-secondary">{b.currency}</td>
                        <td className="px-3 py-2 text-ink-secondary">{b.note ?? "—"}</td>
                      </tr>
                    ))}
                    {(detail.budgets ?? []).length === 0 && <EmptyRow colSpan={4} text="暂无预算" />}
                  </Table>
                </section>
              )}
              {detail.capabilities.expenses && (
                <section className="border-border rounded-md border p-4">
                  <SectionTitle>费用（{detail.expenses?.length ?? 0}）</SectionTitle>
                  <Table headers={["科目", "金额", "币种", "发生时间", "备注"]}>
                    {(detail.expenses ?? []).map((e) => (
                      <tr key={e.id}>
                        <td className="px-3 py-2 text-ink-primary">{e.category}</td>
                        <td className="px-3 py-2 text-ink-primary">{e.amount}</td>
                        <td className="px-3 py-2 text-ink-secondary">{e.currency}</td>
                        <td className="px-3 py-2 text-ink-secondary">{formatDate(e.incurredAt)}</td>
                        <td className="px-3 py-2 text-ink-secondary">{e.note ?? "—"}</td>
                      </tr>
                    ))}
                    {(detail.expenses ?? []).length === 0 && <EmptyRow colSpan={5} text="暂无费用" />}
                  </Table>
                </section>
              )}
              {detail.capabilities.progresses && (
                <section className="border-border rounded-md border p-4">
                  <SectionTitle>进度记录（{detail.progresses?.length ?? 0}）</SectionTitle>
                  <Table headers={["记录时间", "进度", "进展说明"]}>
                    {(detail.progresses ?? []).map((p) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2 text-ink-secondary">{formatDate(p.recordedAt)}</td>
                        <td className="px-3 py-2 text-ink-primary">{p.progressPercent}%</td>
                        <td className="px-3 py-2 text-ink-secondary">{p.summary}</td>
                      </tr>
                    ))}
                    {(detail.progresses ?? []).length === 0 && (
                      <EmptyRow colSpan={3} text="暂无进度记录" />
                    )}
                  </Table>
                </section>
              )}
            </div>
          )}

          {activeTab === "acceptance" && (
            <div className="space-y-6">
              {detail.capabilities.acceptances && (
                <section className="border-border rounded-md border p-4">
                  <SectionTitle>验收项（{detail.acceptances?.length ?? 0}）</SectionTitle>
                  <Table headers={["验收项", "计划日期", "实际日期", "结果", "结果说明"]}>
                    {(detail.acceptances ?? []).map((a) => (
                      <tr key={a.id}>
                        <td className="px-3 py-2 text-ink-primary">{a.name}</td>
                        <td className="px-3 py-2 text-ink-secondary">{formatDate(a.expectedDate)}</td>
                        <td className="px-3 py-2 text-ink-secondary">{formatDate(a.actualDate)}</td>
                        <td className="px-3 py-2">
                          <StatusBadge
                            status={a.result}
                            label={ACCEPTANCE_RESULT_LABELS[a.result] ?? a.result}
                            tone={ACCEPTANCE_TONE_MAP[a.result] ?? "neutral"}
                          />
                        </td>
                        <td className="px-3 py-2 text-ink-secondary">{a.resultNote ?? "—"}</td>
                      </tr>
                    ))}
                    {(detail.acceptances ?? []).length === 0 && (
                      <EmptyRow colSpan={5} text="暂无验收项" />
                    )}
                  </Table>
                </section>
              )}
              {detail.capabilities.closure && detail.closure && (
                <section className="border-border rounded-md border p-4">
                  <SectionTitle>结项</SectionTitle>
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    <InfoItem label="结项时间" value={formatDate(detail.closure.closedAt)} />
                    <InfoItem label="结项原因" value={detail.closure.reason} />
                  </div>
                </section>
              )}
            </div>
          )}

          {activeTab === "tags" && (
            <section className="border-border rounded-md border p-4">
              <SectionTitle>标签（{detail.tags?.length ?? 0}）</SectionTitle>
              <div className="flex flex-wrap gap-2">
                {(detail.tags ?? []).map((t) => (
                  <span
                    key={t.id}
                    className="rounded-md border px-2.5 py-1 text-sm text-ink-secondary"
                    style={{
                      backgroundColor: t.tag?.color ? `${t.tag.color}1a` : undefined,
                      borderColor: t.tag?.color ?? undefined,
                    }}
                  >
                    {t.tag?.name ?? t.tag?.code ?? "—"}
                  </span>
                ))}
                {(detail.tags ?? []).length === 0 && (
                  <p className="text-sm text-ink-muted">暂无标签</p>
                )}
              </div>
            </section>
          )}
        </div>
      </EntityDetailWorkspace>

      {/* B2-1A：共享 Dialog（Stakeholders / Members）+ Delete 确认（CTO #12350/#12368/#12422） */}
      <ProjectSubresourceDialog
        open={stakeholderDialog.open}
        mode={stakeholderDialog.mode}
        title={stakeholderDialog.mode === "create" ? "添加关系人" : "编辑关系人"}
        saving={saving}
        error={dialogError}
        onSubmit={submitStakeholder}
        onReload={reloadStakeholder}
        onClose={closeStakeholderDialog}
      >
        <StakeholderFields
          value={stakeholderForm}
          onChange={setStakeholderForm}
          roleLabels={STAKEHOLDER_ROLE_LABELS}
        />
      </ProjectSubresourceDialog>

      <ProjectSubresourceDialog
        open={memberDialog.open}
        mode={memberDialog.mode}
        title={memberDialog.mode === "create" ? "添加成员" : "编辑成员"}
        saving={saving}
        error={dialogError}
        onSubmit={submitMember}
        onReload={reloadMember}
        onClose={closeMemberDialog}
      >
        <MemberFields value={memberForm} onChange={setMemberForm} />
      </ProjectSubresourceDialog>

      <ConfirmActionDialog
        open={deleteTarget !== null}
        title={
          deleteTarget
            ? `删除${deleteTarget.resource === "stakeholder" ? "关系人" : "成员"}「${deleteTarget.name}」？`
            : ""
        }
        tone="danger"
        confirmLabel="删除"
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.PROJECT_READ}>
      <ProjectDetailPage />
    </PermissionGuard>
  );
}
