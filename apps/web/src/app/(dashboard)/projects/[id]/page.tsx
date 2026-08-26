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
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import {
  AppPage,
  EntityDetailWorkspace,
  StatusBadge,
  ErrorPanel,
  ConfirmActionDialog,
  ProjectSubresourceDialog,
} from "@/components/workspace";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { formatDate, formatMoneyValue } from "@/lib/format";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { PageLoading } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  PROJECT_STAGE_LABELS as STAGE_LABELS,
  PROJECT_STAGE_TONES as STAGE_TONE_MAP,
  PROJECT_PRIORITY_LABELS as PRIORITY_LABELS,
  PROJECT_PAYMENT_LABELS as PAYMENT_LABELS,
  PROJECT_TASK_STATUS_LABELS as TASK_STATUS_LABELS,
  PROJECT_RISK_STATUS_LABELS as RISK_STATUS_LABELS,
  PROJECT_RISK_PROBABILITY_LABELS as RISK_PROBABILITY_LABELS,
  PROJECT_MILESTONE_STATUS_LABELS as MILESTONE_STATUS_LABELS,
  PROJECT_STAKEHOLDER_ROLE_LABELS as STAKEHOLDER_ROLE_LABELS,
  PROJECT_SUBRESOURCE_LABELS as SUBRESOURCE_LABELS,
  PROJECT_VISIT_TYPE_LABELS as VISIT_TYPE_LABELS,
  PROJECT_ACCEPTANCE_RESULT_LABELS as ACCEPTANCE_RESULT_LABELS,
  PROJECT_ACCEPTANCE_TONES as ACCEPTANCE_TONE_MAP,
} from "@/lib/project-stage";
import {
  SubresourceCard,
  DetailTable,
  TruncatedCell,
  RowActionButtons,
} from "./detail-components";
import {
  StakeholderFields,
  MemberFields,
  MilestoneFields,
  TaskFields,
  RiskFields,
  VisitFields,
  ProductFields,
  TagFields,
  BudgetFields,
  ExpenseFields,
  ProgressFields,
  AcceptanceFields,
  EMPTY_STAKEHOLDER_FORM,
  EMPTY_MEMBER_FORM,
  EMPTY_MILESTONE_FORM,
  EMPTY_TASK_FORM,
  EMPTY_RISK_FORM,
  EMPTY_VISIT_FORM,
  EMPTY_PRODUCT_FORM,
  EMPTY_TAG_FORM,
  EMPTY_BUDGET_FORM,
  EMPTY_EXPENSE_FORM,
  EMPTY_PROGRESS_FORM,
  EMPTY_ACCEPTANCE_FORM,
  type StakeholderFormValue,
  type MemberFormValue,
  type MilestoneFormValue,
  type TaskFormValue,
  type RiskFormValue,
  type VisitFormValue,
  type ProductFormValue,
  type TagFormValue,
  type BudgetFormValue,
  type ExpenseFormValue,
  type ProgressFormValue,
  type AcceptanceFormValue,
} from "./subresource-fields";

interface ProjectDetail {
  id: string;
  code: string;
  name: string;
  stage: string;
  version: number; // L2-B1：transition payload 需要 authoritative project version（CAS）
  allowedTransitions: string[]; // L2-B1：backend authoritative read projection（唯一候选来源）
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
    milestoneId?: string | null;
    description?: string | null;
  }>;
  products?: Array<{
    id: string;
    version: number;
    quantity?: string | null;
    unitPrice?: string | null;
    note?: string | null;
    item?: { id: string; code: string | null; name: string | null; model: string | null } | null;
  }>;
  risks?: Array<{
    id: string;
    version: number;
    description: string;
    status: string;
    probability?: string | null;
    impact?: string | null;
    mitigation?: string | null;
  }>;
  visits?: Array<{
    id: string;
    version: number;
    visitType: string;
    visitedAt: string;
    contactName?: string | null;
    summary?: string | null;
    nextAction?: string | null;
    reminderAt?: string | null;
  }>;
  budgets?: Array<{
    id: string;
    version: number;
    category: string;
    amount: string;
    currency: string;
    note?: string | null;
  }>;
  expenses?: Array<{
    id: string;
    version: number;
    category: string;
    amount: string;
    currency: string;
    incurredAt?: string | null;
    note?: string | null;
  }>;
  progresses?: Array<{
    id: string;
    version: number;
    recordedAt: string;
    progressPercent: string;
    summary: string;
  }>;
  acceptances?: Array<{
    id: string;
    version: number;
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
type MilestoneRow = NonNullable<ProjectDetail["milestones"]>[number];
type TaskRow = NonNullable<ProjectDetail["tasks"]>[number];
type RiskRow = NonNullable<ProjectDetail["risks"]>[number];
type VisitRow = NonNullable<ProjectDetail["visits"]>[number];
type ProductRow = NonNullable<ProjectDetail["products"]>[number];
type BudgetRow = NonNullable<ProjectDetail["budgets"]>[number];
type ExpenseRow = NonNullable<ProjectDetail["expenses"]>[number];
type ProgressRow = NonNullable<ProjectDetail["progresses"]>[number];
type AcceptanceRow = NonNullable<ProjectDetail["acceptances"]>[number];

// UI-06：状态文案/语义色映射统一消费 lib/project-stage.ts（aliased imports，见文件头）
// 阶段/优先级/回款/任务/风险/里程碑/关系人/走访/验收/子资源标签文案不再在页面内重复定义。


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


/** B2-2B：date 时区转换纪律（用户指令 2026-08-21：全站取消分钟格式 → date YYYY-MM-DD）
 * toLocalInput：ISO UTC → 本地 date（YYYY-MM-DD）
 * toIso：date 本地时间 → Date → ISO UTC
 */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toIso(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function ProjectDetailPage() {
  const { state } = useSession();
  const toast = useToast();
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
  const [milestoneDialog, setMilestoneDialog] = useState<{
    open: boolean;
    mode: "create" | "edit";
    id: string | null;
    version: number | null;
  }>({ open: false, mode: "create", id: null, version: null });
  const [taskDialog, setTaskDialog] = useState<{
    open: boolean;
    mode: "create" | "edit";
    id: string | null;
    version: number | null;
  }>({ open: false, mode: "create", id: null, version: null });
  const [riskDialog, setRiskDialog] = useState<{
    open: boolean;
    mode: "create" | "edit";
    id: string | null;
    version: number | null;
  }>({ open: false, mode: "create", id: null, version: null });
  const [visitDialog, setVisitDialog] = useState<{
    open: boolean;
    mode: "create" | "edit";
    id: string | null;
    version: number | null;
  }>({ open: false, mode: "create", id: null, version: null });
  const [productDialog, setProductDialog] = useState<{
    open: boolean;
    mode: "create" | "edit";
    id: string | null;
    version: number | null;
  }>({ open: false, mode: "create", id: null, version: null });
  const [tagDialog, setTagDialog] = useState<{
    open: boolean;
    mode: "create";
    id: null;
    version: null;
  }>({ open: false, mode: "create", id: null, version: null });
  const [budgetDialog, setBudgetDialog] = useState<{
    open: boolean;
    mode: "create" | "edit";
    id: string | null;
    version: number | null;
  }>({ open: false, mode: "create", id: null, version: null });
  const [expenseDialog, setExpenseDialog] = useState<{
    open: boolean;
    mode: "create" | "edit";
    id: string | null;
    version: number | null;
  }>({ open: false, mode: "create", id: null, version: null });
  const [progressDialog, setProgressDialog] = useState<{
    open: boolean;
    mode: "create" | "edit";
    id: string | null;
    version: number | null;
  }>({ open: false, mode: "create", id: null, version: null });
  // L2-A：acceptance dialog（验收项，PATCH version CAS；不复制生命周期/事件逻辑）
  const [acceptanceDialog, setAcceptanceDialog] = useState<{
    open: boolean;
    mode: "create" | "edit";
    id: string | null;
    version: number | null;
  }>({ open: false, mode: "create", id: null, version: null });
  // L2-B1：Transition command dialog（唯一候选来源 = detail.allowedTransitions；不复制状态机）
  const [transitionDialog, setTransitionDialog] = useState<{
    open: boolean;
    targetStage: string;
    remark: string;
    saving: boolean;
    error: ApiClientError | null;
  }>({ open: false, targetStage: "", remark: "", saving: false, error: null });
  // FRT-05：Close command dialog（消费 backend POST /api/projects/:id/close 契约：
  // reason 必填 + version CAS；force=true 需 project:close + project:approve 双权限）
  const [closeDialog, setCloseDialog] = useState<{
    open: boolean;
    reason: string;
    force: boolean;
    saving: boolean;
    error: ApiClientError | null;
  }>({ open: false, reason: "", force: false, saving: false, error: null });
  const [stakeholderForm, setStakeholderForm] =
    useState<StakeholderFormValue>(EMPTY_STAKEHOLDER_FORM);
  const [memberForm, setMemberForm] = useState<MemberFormValue>(EMPTY_MEMBER_FORM);
  const [milestoneForm, setMilestoneForm] = useState<MilestoneFormValue>(EMPTY_MILESTONE_FORM);
  const [taskForm, setTaskForm] = useState<TaskFormValue>(EMPTY_TASK_FORM);
  const [riskForm, setRiskForm] = useState<RiskFormValue>(EMPTY_RISK_FORM);
  const [visitForm, setVisitForm] = useState<VisitFormValue>(EMPTY_VISIT_FORM);
  const [productForm, setProductForm] = useState<ProductFormValue>(EMPTY_PRODUCT_FORM);
  const [tagForm, setTagForm] = useState<TagFormValue>(EMPTY_TAG_FORM);
  const [budgetForm, setBudgetForm] = useState<BudgetFormValue>(EMPTY_BUDGET_FORM);
  const [expenseForm, setExpenseForm] = useState<ExpenseFormValue>(EMPTY_EXPENSE_FORM);
  const [progressForm, setProgressForm] = useState<ProgressFormValue>(EMPTY_PROGRESS_FORM);
  const [acceptanceForm, setAcceptanceForm] = useState<AcceptanceFormValue>(EMPTY_ACCEPTANCE_FORM);
  // L2-A：authoritative init snapshot，Edit PATCH 只发 changed fields（同 B2-2A 纪律）
  const [acceptanceInit, setAcceptanceInit] = useState<{
    name: string;
    expectedDate: string; // 原始完整 ISO datetime（"" = null）
    actualDate: string; // 原始完整 ISO datetime（"" = null）
    result: string;
    resultNote: string;
  } | null>(null);
  // B2-2A Hotfix：authoritative init snapshot，Edit PATCH 只发 changed fields（避免无关编辑改写 timestamp / 无意义 version+1）
  const [budgetInit, setBudgetInit] = useState<{
    category: string;
    amount: string;
    currency: string;
    note: string;
  } | null>(null);
  const [expenseInit, setExpenseInit] = useState<{
    category: string;
    amount: string;
    currency: string;
    incurredAt: string; // 原始完整 ISO datetime（"" = null）
    note: string;
  } | null>(null);
  const [progressInit, setProgressInit] = useState<{
    recordedAt: string; // 原始完整 ISO datetime（"" = null）
    progressPercent: string;
    summary: string;
  } | null>(null);
  // B2-1B-2：item selector 消费真实 /api/items；tag selector 消费真实 /api/tags（CTO #13632）
  const [itemOptions, setItemOptions] = useState<Array<{ id: string; code: string | null; name: string | null }>>([]);
  const [tagOptions, setTagOptions] = useState<Array<{ id: string; code: string | null; name: string | null }>>([]);
  // B2-1B（CTO #13762）：selector 显式 loading/error——不静默吞错、不把失败伪装成合法 empty state
  const [itemOptionsError, setItemOptionsError] = useState<ApiClientError | null>(null);
  const [tagOptionsError, setTagOptionsError] = useState<ApiClientError | null>(null);
  const [itemOptionsLoading, setItemOptionsLoading] = useState(true);
  const [tagOptionsLoading, setTagOptionsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState<ApiClientError | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    resource:
      | "stakeholder"
      | "member"
      | "milestone"
      | "task"
      | "risk"
      | "visit"
      | "product"
      | "tag"
      | "budget"
      | "expense"
      | "progress"
      | "acceptance";
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

  // B2-1B-2：item/tag selector 独立加载真实数据源；失败显式报错（不静默吞错，CTO #13762）
  useEffect(() => {
    const controller = new AbortController();
    setItemOptionsLoading(true);
    apiFetch<Array<{ id: string; code: string | null; name: string | null }>>(
      "/api/items?pageSize=100",
      { signal: controller.signal },
    )
      .then((body) => {
        setItemOptions(body.data);
        setItemOptionsError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setItemOptionsError(
          err instanceof ApiClientError ? err : new ApiClientError(0, "加载物料失败", "NETWORK_ERROR"),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setItemOptionsLoading(false);
      });
    setTagOptionsLoading(true);
    // project-tag POST 拒绝 disabled tag → selector 只取 enabled=true（CTO #13762）
    apiFetch<Array<{ id: string; code: string | null; name: string | null }>>(
      "/api/tags?enabled=true&pageSize=100",
      { signal: controller.signal },
    )
      .then((body) => {
        setTagOptions(body.data);
        setTagOptionsError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setTagOptionsError(
          err instanceof ApiClientError ? err : new ApiClientError(0, "加载标签失败", "NETWORK_ERROR"),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setTagOptionsLoading(false);
      });
    return () => controller.abort();
  }, []);

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

  // 日期转换 helper（B2-1A-2，CTO #12452）：Member/Milestone/Task 共用；blank→null，有值转 ISO datetime
  const dateToIsoOrNull = (v: string): string | null =>
    v === "" ? null : new Date(`${v}T00:00:00.000Z`).toISOString();

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

  const openMilestoneCreate = () => {
    setMilestoneForm(EMPTY_MILESTONE_FORM);
    setDialogError(null);
    setMilestoneDialog({ open: true, mode: "create", id: null, version: null });
  };
  const openMilestoneEdit = (m: MilestoneRow) => {
    setMilestoneForm({
      name: m.name,
      plannedDate: m.plannedDate ? m.plannedDate.slice(0, 10) : "",
      actualDate: m.actualDate ? m.actualDate.slice(0, 10) : "",
      status: m.status as MilestoneFormValue["status"],
      deliverable: m.deliverable ?? "",
      delayReason: m.delayReason ?? "",
    });
    setDialogError(null);
    setMilestoneDialog({ open: true, mode: "edit", id: m.id, version: m.version });
  };
  const closeMilestoneDialog = () =>
    setMilestoneDialog({ open: false, mode: "create", id: null, version: null });

  const openTaskCreate = () => {
    setTaskForm(EMPTY_TASK_FORM);
    setDialogError(null);
    setTaskDialog({ open: true, mode: "create", id: null, version: null });
  };
  const openTaskEdit = (t: TaskRow) => {
    setTaskForm({
      milestoneId: t.milestoneId ?? "",
      name: t.name,
      dueDate: t.dueDate ? t.dueDate.slice(0, 10) : "",
      status: t.status as TaskFormValue["status"],
      priority: (t.priority ?? "") as TaskFormValue["priority"],
      description: t.description ?? "",
    });
    setDialogError(null);
    setTaskDialog({ open: true, mode: "edit", id: t.id, version: t.version });
  };
  const closeTaskDialog = () =>
    setTaskDialog({ open: false, mode: "create", id: null, version: null });

  const openRiskCreate = () => {
    setRiskForm(EMPTY_RISK_FORM);
    setDialogError(null);
    setRiskDialog({ open: true, mode: "create", id: null, version: null });
  };
  const openRiskEdit = (r: RiskRow) => {
    setRiskForm({
      description: r.description,
      impact: r.impact ?? "",
      probability: (r.probability ?? "") as RiskFormValue["probability"],
      mitigation: r.mitigation ?? "",
      status: r.status as RiskFormValue["status"],
    });
    setDialogError(null);
    setRiskDialog({ open: true, mode: "edit", id: r.id, version: r.version });
  };
  const closeRiskDialog = () =>
    setRiskDialog({ open: false, mode: "create", id: null, version: null });

  const openVisitCreate = () => {
    setVisitForm(EMPTY_VISIT_FORM);
    setDialogError(null);
    setVisitDialog({ open: true, mode: "create", id: null, version: null });
  };
  const openVisitEdit = (v: VisitRow) => {
    setVisitForm({
      visitType: v.visitType as VisitFormValue["visitType"],
      visitedAt: v.visitedAt ? v.visitedAt.slice(0, 10) : "",
      contactName: v.contactName ?? "",
      summary: v.summary ?? "",
      nextAction: v.nextAction ?? "",
      reminderAt: v.reminderAt ? v.reminderAt.slice(0, 10) : "",
    });
    setDialogError(null);
    setVisitDialog({ open: true, mode: "edit", id: v.id, version: v.version });
  };
  const closeVisitDialog = () =>
    setVisitDialog({ open: false, mode: "create", id: null, version: null });

  const openProductCreate = () => {
    setProductForm(EMPTY_PRODUCT_FORM);
    setDialogError(null);
    setProductDialog({ open: true, mode: "create", id: null, version: null });
  };
  const openProductEdit = (p: ProductRow) => {
    // Edit 时 item 锁定不可变更（PATCH 不接收 itemId）；quantity/note 回填可编辑
    setProductForm({
      itemId: p.item?.id ?? "",
      quantity: p.quantity ?? "",
      note: p.note ?? "",
    });
    setDialogError(null);
    setProductDialog({ open: true, mode: "edit", id: p.id, version: p.version });
  };
  const closeProductDialog = () =>
    setProductDialog({ open: false, mode: "create", id: null, version: null });

  // Tags 仅 Add（无 Edit/PATCH，UI 不造编辑入口，CTO #13632）
  const openTagCreate = () => {
    setTagForm(EMPTY_TAG_FORM);
    setDialogError(null);
    setTagDialog({ open: true, mode: "create", id: null, version: null });
  };
  const closeTagDialog = () =>
    setTagDialog({ open: false, mode: "create", id: null, version: null });

  const openBudgetCreate = () => {
    setBudgetForm(EMPTY_BUDGET_FORM);
    setBudgetInit(null);
    setDialogError(null);
    setBudgetDialog({ open: true, mode: "create", id: null, version: null });
  };
  const openBudgetEdit = (b: BudgetRow) => {
    setBudgetForm({
      category: b.category,
      amount: b.amount,
      currency: b.currency,
      note: b.note ?? "",
    });
    setBudgetInit({
      category: b.category,
      amount: b.amount,
      currency: b.currency,
      note: b.note ?? "",
    });
    setDialogError(null);
    setBudgetDialog({ open: true, mode: "edit", id: b.id, version: b.version });
  };
  const closeBudgetDialog = () =>
    setBudgetDialog({ open: false, mode: "create", id: null, version: null });

  const openExpenseCreate = () => {
    setExpenseForm(EMPTY_EXPENSE_FORM);
    setExpenseInit(null);
    setDialogError(null);
    setExpenseDialog({ open: true, mode: "create", id: null, version: null });
  };
  const openExpenseEdit = (e: ExpenseRow) => {
    setExpenseForm({
      category: e.category,
      amount: e.amount,
      currency: e.currency,
      incurredAt: e.incurredAt ? e.incurredAt.slice(0, 10) : "",
      note: e.note ?? "",
    });
    // init 存原始完整 ISO incurredAt（不做 date 截断），用于 changed-only 判断
    setExpenseInit({
      category: e.category,
      amount: e.amount,
      currency: e.currency,
      incurredAt: e.incurredAt ?? "",
      note: e.note ?? "",
    });
    setDialogError(null);
    setExpenseDialog({ open: true, mode: "edit", id: e.id, version: e.version });
  };
  const closeExpenseDialog = () =>
    setExpenseDialog({ open: false, mode: "create", id: null, version: null });

  const openProgressCreate = () => {
    setProgressForm(EMPTY_PROGRESS_FORM);
    setProgressInit(null);
    setDialogError(null);
    setProgressDialog({ open: true, mode: "create", id: null, version: null });
  };
  const openProgressEdit = (p: ProgressRow) => {
    setProgressForm({
      recordedAt: p.recordedAt ? toLocalInput(p.recordedAt) : "",
      progressPercent: p.progressPercent,
      summary: p.summary,
    });
    setProgressInit({
      recordedAt: p.recordedAt ?? "",
      progressPercent: p.progressPercent,
      summary: p.summary,
    });
    setDialogError(null);
    setProgressDialog({ open: true, mode: "edit", id: p.id, version: p.version });
  };
  const closeProgressDialog = () =>
    setProgressDialog({ open: false, mode: "create", id: null, version: null });

  // L2-A：acceptance dialog 开关（只做 CRUD 交互；ProjectAccepted 事件由 backend 负责，前端不复制）
  const openAcceptanceCreate = () => {
    setAcceptanceForm(EMPTY_ACCEPTANCE_FORM);
    setAcceptanceInit(null);
    setDialogError(null);
    setAcceptanceDialog({ open: true, mode: "create", id: null, version: null });
  };
  const openAcceptanceEdit = (a: AcceptanceRow) => {
    setAcceptanceForm({
      name: a.name,
      expectedDate: a.expectedDate ? toLocalInput(a.expectedDate) : "",
      actualDate: a.actualDate ? toLocalInput(a.actualDate) : "",
      result: a.result as AcceptanceFormValue["result"],
      resultNote: a.resultNote ?? "",
    });
    // init 存原始完整 ISO datetime（不做 date 截断），用于 changed-only 判断
    setAcceptanceInit({
      name: a.name,
      expectedDate: a.expectedDate ?? "",
      actualDate: a.actualDate ?? "",
      result: a.result,
      resultNote: a.resultNote ?? "",
    });
    setDialogError(null);
    setAcceptanceDialog({ open: true, mode: "edit", id: a.id, version: a.version });
  };
  const closeAcceptanceDialog = () =>
    setAcceptanceDialog({ open: false, mode: "create", id: null, version: null });

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
      toast.success("关系人已保存");
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
      const payload = {
        name: memberForm.name,
        roleInProject: memberForm.roleInProject === "" ? null : memberForm.roleInProject,
        joinedAt: dateToIsoOrNull(memberForm.joinedAt),
        leftAt: dateToIsoOrNull(memberForm.leftAt),
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
      toast.success("成员已保存");
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

  const submitMilestone = async () => {
    if (!milestoneDialog.open) return;
    setSaving(true);
    setDialogError(null);
    try {
      const payload = {
        name: milestoneForm.name,
        plannedDate: dateToIsoOrNull(milestoneForm.plannedDate),
        actualDate: dateToIsoOrNull(milestoneForm.actualDate),
        status: milestoneForm.status,
        deliverable: milestoneForm.deliverable === "" ? null : milestoneForm.deliverable,
        delayReason: milestoneForm.delayReason === "" ? null : milestoneForm.delayReason,
      };
      // COMPLETED 的 Domain Event 语义留在 backend：UI 只发送 status，不自动填 actualDate（CTO #12446）
      if (milestoneDialog.mode === "create") {
        await apiFetch(`/api/projects/${id}/milestones`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else if (milestoneDialog.id && milestoneDialog.version != null) {
        await apiFetch(`/api/projects/${id}/milestones/${milestoneDialog.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, version: milestoneDialog.version }),
        });
      }
      closeMilestoneDialog();
      toast.success("里程碑已保存");
      await reloadProject();
    } catch (err) {
      setDialogError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "保存失败", "NETWORK_ERROR"),
      );
    } finally {
      setSaving(false);
    }
  };

  const reloadMilestone = async () => {
    if (!milestoneDialog.open || !milestoneDialog.id) return;
    setSaving(true);
    try {
      const body = await apiFetch<MilestoneRow>(
        `/api/projects/${id}/milestones/${milestoneDialog.id}`,
      );
      const m = body.data;
      setMilestoneForm({
        name: m.name,
        plannedDate: m.plannedDate ? m.plannedDate.slice(0, 10) : "",
        actualDate: m.actualDate ? m.actualDate.slice(0, 10) : "",
        status: m.status as MilestoneFormValue["status"],
        deliverable: m.deliverable ?? "",
        delayReason: m.delayReason ?? "",
      });
      setMilestoneDialog({ open: true, mode: "edit", id: m.id, version: m.version });
      setDialogError(null);
    } catch (err) {
      setDialogError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "重新加载失败", "NETWORK_ERROR"),
      );
    } finally {
      setSaving(false);
    }
  };

  const submitTask = async () => {
    if (!taskDialog.open) return;
    setSaving(true);
    setDialogError(null);
    try {
      // assigneeId 不开放：Create/Edit 均不发送（PATCH 不发即保留旧关联，CTO #12446）
      const payload = {
        milestoneId: taskForm.milestoneId === "" ? null : taskForm.milestoneId,
        name: taskForm.name,
        dueDate: dateToIsoOrNull(taskForm.dueDate),
        status: taskForm.status,
        priority: taskForm.priority === "" ? null : taskForm.priority,
        description: taskForm.description === "" ? null : taskForm.description,
      };
      if (taskDialog.mode === "create") {
        await apiFetch(`/api/projects/${id}/tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else if (taskDialog.id && taskDialog.version != null) {
        await apiFetch(`/api/projects/${id}/tasks/${taskDialog.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, version: taskDialog.version }),
        });
      }
      closeTaskDialog();
      toast.success("任务已保存");
      await reloadProject();
    } catch (err) {
      setDialogError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "保存失败", "NETWORK_ERROR"),
      );
    } finally {
      setSaving(false);
    }
  };

  const reloadTask = async () => {
    if (!taskDialog.open || !taskDialog.id) return;
    setSaving(true);
    try {
      const body = await apiFetch<TaskRow>(`/api/projects/${id}/tasks/${taskDialog.id}`);
      const t = body.data;
      setTaskForm({
        milestoneId: t.milestoneId ?? "",
        name: t.name,
        dueDate: t.dueDate ? t.dueDate.slice(0, 10) : "",
        status: t.status as TaskFormValue["status"],
        priority: (t.priority ?? "") as TaskFormValue["priority"],
        description: t.description ?? "",
      });
      setTaskDialog({ open: true, mode: "edit", id: t.id, version: t.version });
      setDialogError(null);
    } catch (err) {
      setDialogError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "重新加载失败", "NETWORK_ERROR"),
      );
    } finally {
      setSaving(false);
    }
  };

  const submitRisk = async () => {
    if (!riskDialog.open) return;
    setSaving(true);
    setDialogError(null);
    try {
      // ownerId 不发送（无正式 user selector，同 B2-1A Members 模式）；status→CLOSED 只提交已有 PATCH 字段，
      // closedAt / ProjectRiskClosed Domain Event 由 backend 负责（CTO #13589）
      const payload = {
        description: riskForm.description,
        impact: riskForm.impact === "" ? null : riskForm.impact,
        probability: riskForm.probability === "" ? null : riskForm.probability,
        mitigation: riskForm.mitigation === "" ? null : riskForm.mitigation,
        status: riskForm.status,
      };
      if (riskDialog.mode === "create") {
        await apiFetch(`/api/projects/${id}/risks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else if (riskDialog.id && riskDialog.version != null) {
        await apiFetch(`/api/projects/${id}/risks/${riskDialog.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, version: riskDialog.version }),
        });
      }
      closeRiskDialog();
      toast.success("风险已保存");
      await reloadProject();
    } catch (err) {
      setDialogError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "保存失败", "NETWORK_ERROR"),
      );
    } finally {
      setSaving(false);
    }
  };

  const reloadRisk = async () => {
    if (!riskDialog.open || !riskDialog.id) return;
    setSaving(true);
    try {
      const body = await apiFetch<RiskRow>(`/api/projects/${id}/risks/${riskDialog.id}`);
      const r = body.data;
      setRiskForm({
        description: r.description,
        impact: r.impact ?? "",
        probability: (r.probability ?? "") as RiskFormValue["probability"],
        mitigation: r.mitigation ?? "",
        status: r.status as RiskFormValue["status"],
      });
      setRiskDialog({ open: true, mode: "edit", id: r.id, version: r.version });
      setDialogError(null);
    } catch (err) {
      setDialogError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "重新加载失败", "NETWORK_ERROR"),
      );
    } finally {
      setSaving(false);
    }
  };

  const submitVisit = async () => {
    if (!visitDialog.open) return;
    setSaving(true);
    setDialogError(null);
    try {
      // visitorId 不发送（无正式 user selector，同 B2-1A Members 模式）；只按真实 schema 字段（CTO #13589）
      const payload = {
        visitType: visitForm.visitType,
        visitedAt:
          visitForm.visitedAt === "" ? undefined : new Date(visitForm.visitedAt).toISOString(),
        contactName: visitForm.contactName === "" ? null : visitForm.contactName,
        summary: visitForm.summary,
        nextAction: visitForm.nextAction === "" ? null : visitForm.nextAction,
        reminderAt:
          visitForm.reminderAt === "" ? null : new Date(visitForm.reminderAt).toISOString(),
      };
      if (visitDialog.mode === "create") {
        await apiFetch(`/api/projects/${id}/visits`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else if (visitDialog.id && visitDialog.version != null) {
        await apiFetch(`/api/projects/${id}/visits/${visitDialog.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, version: visitDialog.version }),
        });
      }
      closeVisitDialog();
      toast.success("走访记录已保存");
      await reloadProject();
    } catch (err) {
      setDialogError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "保存失败", "NETWORK_ERROR"),
      );
    } finally {
      setSaving(false);
    }
  };

  const reloadVisit = async () => {
    if (!visitDialog.open || !visitDialog.id) return;
    setSaving(true);
    try {
      const body = await apiFetch<VisitRow>(`/api/projects/${id}/visits/${visitDialog.id}`);
      const v = body.data;
      setVisitForm({
        visitType: v.visitType as VisitFormValue["visitType"],
        visitedAt: v.visitedAt ? v.visitedAt.slice(0, 10) : "",
        contactName: v.contactName ?? "",
        summary: v.summary ?? "",
        nextAction: v.nextAction ?? "",
        reminderAt: v.reminderAt ? v.reminderAt.slice(0, 10) : "",
      });
      setVisitDialog({ open: true, mode: "edit", id: v.id, version: v.version });
      setDialogError(null);
    } catch (err) {
      setDialogError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "重新加载失败", "NETWORK_ERROR"),
      );
    } finally {
      setSaving(false);
    }
  };

  const submitProduct = async () => {
    if (!productDialog.open) return;
    // create 依赖 item selector：失败/加载中 → 禁止提交（CTO #13762，Save 按钮也已 disabled）
    if (productDialog.mode === "create" && (itemOptionsLoading || itemOptionsError)) {
      setDialogError(
        itemOptionsError ?? new ApiClientError(0, "物料加载中，请稍候", "LOADING"),
      );
      return;
    }
    setSaving(true);
    setDialogError(null);
    try {
      // priceSnapshotId 由报价快照流程维护，UI 不暴露；不前端计算总金额（CTO #13632）
      const payload = {
        itemId: productForm.itemId,
        quantity: productForm.quantity === "" ? null : Number(productForm.quantity),
        note: productForm.note === "" ? null : productForm.note,
      };
      if (productDialog.mode === "create") {
        await apiFetch(`/api/projects/${id}/products`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else if (productDialog.id && productDialog.version != null) {
        // Edit：PATCH 不接收 itemId（item 锁定不可变更）→ 只发 quantity/note + version CAS
        await apiFetch(`/api/projects/${id}/products/${productDialog.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quantity: payload.quantity,
            note: payload.note,
            version: productDialog.version,
          }),
        });
      }
      closeProductDialog();
      toast.success("产品已保存");
      await reloadProject();
    } catch (err) {
      setDialogError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "保存失败", "NETWORK_ERROR"),
      );
    } finally {
      setSaving(false);
    }
  };

  const reloadProduct = async () => {
    if (!productDialog.open || !productDialog.id) return;
    setSaving(true);
    try {
      const body = await apiFetch<ProductRow>(`/api/projects/${id}/products/${productDialog.id}`);
      const p = body.data;
      setProductForm({
        itemId: p.item?.id ?? "",
        quantity: p.quantity ?? "",
        note: p.note ?? "",
      });
      setProductDialog({ open: true, mode: "edit", id: p.id, version: p.version });
      setDialogError(null);
    } catch (err) {
      setDialogError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "重新加载失败", "NETWORK_ERROR"),
      );
    } finally {
      setSaving(false);
    }
  };

  // Tags 仅 Add（无 Edit/PATCH）；重复 tag 前端可提示，backend 仍 409 兜底（CTO #13632）
  const submitTag = async () => {
    if (!tagDialog.open) return;
    // Tag selector 失败/加载中 → 禁止提交（CTO #13762，Save 按钮也已 disabled）
    if (tagOptionsLoading || tagOptionsError) {
      setDialogError(
        tagOptionsError ?? new ApiClientError(0, "标签加载中，请稍候", "LOADING"),
      );
      return;
    }
    setSaving(true);
    setDialogError(null);
    try {
      await apiFetch(`/api/projects/${id}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagId: tagForm.tagId }),
      });
      closeTagDialog();
      toast.success("标签已添加");
      await reloadProject();
    } catch (err) {
      setDialogError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "保存失败", "NETWORK_ERROR"),
      );
    } finally {
      setSaving(false);
    }
  };

  const submitBudget = async () => {
    if (!budgetDialog.open) return;
    // Hotfix：amount blank 禁止提交，不静默转 0
    if (budgetForm.amount.trim() === "") {
      setDialogError(new ApiClientError(400, "金额不能为空", "VALIDATION"));
      return;
    }
    setSaving(true);
    setDialogError(null);
    try {
      // 金额纪律：amount 仅作为单条明细事实提交，不前端求和（CTO B2-2A）
      if (budgetDialog.mode === "create") {
        await apiFetch(`/api/projects/${id}/budgets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: budgetForm.category,
            amount: Number(budgetForm.amount),
            currency: budgetForm.currency.trim() === "" ? "CNY" : budgetForm.currency,
            note: budgetForm.note.trim() === "" ? null : budgetForm.note,
          }),
        });
      } else if (budgetDialog.id && budgetDialog.version != null && budgetInit) {
        // Hotfix：Edit PATCH 只发 changed fields（避免无意义 version+1）
        const changes: Record<string, unknown> = {};
        if (budgetForm.category !== budgetInit.category) changes.category = budgetForm.category;
        if (budgetForm.amount !== budgetInit.amount) changes.amount = Number(budgetForm.amount);
        if (budgetForm.currency !== budgetInit.currency)
          changes.currency = budgetForm.currency.trim() === "" ? "CNY" : budgetForm.currency;
        if (budgetForm.note !== budgetInit.note)
          changes.note = budgetForm.note.trim() === "" ? null : budgetForm.note;
        if (Object.keys(changes).length === 0) {
          closeBudgetDialog();
          return;
        }
        await apiFetch(`/api/projects/${id}/budgets/${budgetDialog.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...changes, version: budgetDialog.version }),
        });
      }
      closeBudgetDialog();
      toast.success("预算已保存");
      await reloadProject();
    } catch (err) {
      setDialogError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "保存失败", "NETWORK_ERROR"),
      );
    } finally {
      setSaving(false);
    }
  };

  const reloadBudget = async () => {
    if (!budgetDialog.open || !budgetDialog.id) return;
    setSaving(true);
    try {
      const body = await apiFetch<BudgetRow>(`/api/projects/${id}/budgets/${budgetDialog.id}`);
      const b = body.data;
      setBudgetForm({ category: b.category, amount: b.amount, currency: b.currency, note: b.note ?? "" });
      setBudgetInit({ category: b.category, amount: b.amount, currency: b.currency, note: b.note ?? "" });
      setBudgetDialog({ open: true, mode: "edit", id: b.id, version: b.version });
      setDialogError(null);
    } catch (err) {
      setDialogError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "重新加载失败", "NETWORK_ERROR"),
      );
    } finally {
      setSaving(false);
    }
  };

  const submitExpense = async () => {
    if (!expenseDialog.open) return;
    // Hotfix：amount blank 禁止提交，不静默转 0
    if (expenseForm.amount.trim() === "") {
      setDialogError(new ApiClientError(400, "金额不能为空", "VALIDATION"));
      return;
    }
    setSaving(true);
    setDialogError(null);
    try {
      // 金额纪律同 Budget：amount 是单条支出事实，不前端求和（CTO B2-2A）
      if (expenseDialog.mode === "create") {
        await apiFetch(`/api/projects/${id}/expenses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: expenseForm.category,
            amount: Number(expenseForm.amount),
            currency: expenseForm.currency.trim() === "" ? "CNY" : expenseForm.currency,
            incurredAt:
              expenseForm.incurredAt === ""
                ? null
                : new Date(`${expenseForm.incurredAt}T00:00:00.000Z`).toISOString(),
            note: expenseForm.note.trim() === "" ? null : expenseForm.note,
          }),
        });
      } else if (expenseDialog.id && expenseDialog.version != null && expenseInit) {
        // Hotfix：Edit PATCH 只发 changed fields；incurredAt 只有用户实际改动才发（清空→null，没碰→不发送）
        const changes: Record<string, unknown> = {};
        if (expenseForm.category !== expenseInit.category) changes.category = expenseForm.category;
        if (expenseForm.amount !== expenseInit.amount) changes.amount = Number(expenseForm.amount);
        if (expenseForm.currency !== expenseInit.currency)
          changes.currency = expenseForm.currency.trim() === "" ? "CNY" : expenseForm.currency;
        if (expenseForm.note !== expenseInit.note)
          changes.note = expenseForm.note.trim() === "" ? null : expenseForm.note;
        const initIncurredAtDate = expenseInit.incurredAt === "" ? "" : expenseInit.incurredAt.slice(0, 10);
        if (expenseForm.incurredAt !== initIncurredAtDate) {
          changes.incurredAt =
            expenseForm.incurredAt === ""
              ? null
              : new Date(`${expenseForm.incurredAt}T00:00:00.000Z`).toISOString();
        }
        if (Object.keys(changes).length === 0) {
          closeExpenseDialog();
          return;
        }
        await apiFetch(`/api/projects/${id}/expenses/${expenseDialog.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...changes, version: expenseDialog.version }),
        });
      }
      closeExpenseDialog();
      toast.success("费用已保存");
      await reloadProject();
    } catch (err) {
      setDialogError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "保存失败", "NETWORK_ERROR"),
      );
    } finally {
      setSaving(false);
    }
  };

  const reloadExpense = async () => {
    if (!expenseDialog.open || !expenseDialog.id) return;
    setSaving(true);
    try {
      const body = await apiFetch<ExpenseRow>(`/api/projects/${id}/expenses/${expenseDialog.id}`);
      const e = body.data;
      setExpenseForm({
        category: e.category,
        amount: e.amount,
        currency: e.currency,
        incurredAt: e.incurredAt ? e.incurredAt.slice(0, 10) : "",
        note: e.note ?? "",
      });
      setExpenseInit({
        category: e.category,
        amount: e.amount,
        currency: e.currency,
        incurredAt: e.incurredAt ?? "",
        note: e.note ?? "",
      });
      setExpenseDialog({ open: true, mode: "edit", id: e.id, version: e.version });
      setDialogError(null);
    } catch (err) {
      setDialogError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "重新加载失败", "NETWORK_ERROR"),
      );
    } finally {
      setSaving(false);
    }
  };

  const submitProgress = async () => {
    if (!progressDialog.open) return;
    // 必填 Gate：progressPercent 0-100、summary 非空；blank 不静默转 0
    if (progressForm.progressPercent.trim() === "") {
      setDialogError(new ApiClientError(400, "进度百分比不能为空", "VALIDATION"));
      return;
    }
    const pct = Number(progressForm.progressPercent);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      setDialogError(new ApiClientError(400, "进度百分比必须在 0-100 之间", "VALIDATION"));
      return;
    }
    if (progressForm.summary.trim() === "") {
      setDialogError(new ApiClientError(400, "进展说明不能为空", "VALIDATION"));
      return;
    }
    setSaving(true);
    setDialogError(null);
    try {
      if (progressDialog.mode === "create") {
        await apiFetch(`/api/projects/${id}/progress`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recordedAt:
              progressForm.recordedAt === "" ? undefined : toIso(progressForm.recordedAt),
            progressPercent: pct,
            summary: progressForm.summary,
          }),
        });
      } else if (progressDialog.id && progressDialog.version != null && progressInit) {
        // changed-only PATCH：无变化不发送；recordedAt 只有用户实际改动才发（空 → 不发送，保留原值）
        const changes: Record<string, unknown> = {};
        const initRecordedAtDate = progressInit.recordedAt === "" ? "" : toLocalInput(progressInit.recordedAt);
        if (progressForm.recordedAt !== initRecordedAtDate && progressForm.recordedAt !== "") {
          changes.recordedAt = toIso(progressForm.recordedAt);
        }
        if (progressForm.progressPercent !== progressInit.progressPercent) changes.progressPercent = pct;
        if (progressForm.summary !== progressInit.summary) changes.summary = progressForm.summary;
        if (Object.keys(changes).length === 0) {
          closeProgressDialog();
          return;
        }
        await apiFetch(`/api/projects/${id}/progress/${progressDialog.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...changes, version: progressDialog.version }),
        });
      }
      closeProgressDialog();
      toast.success("进度记录已保存");
      // 红线：Project.progressPercent 是唯一 authoritative aggregate，mutation 后 re-GET aggregate（不前端自算）
      await reloadProject();
    } catch (err) {
      setDialogError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "保存失败", "NETWORK_ERROR"),
      );
    } finally {
      setSaving(false);
    }
  };

  const reloadProgress = async () => {
    if (!progressDialog.open || !progressDialog.id) return;
    setSaving(true);
    try {
      const body = await apiFetch<ProgressRow>(`/api/projects/${id}/progress/${progressDialog.id}`);
      const p = body.data;
      setProgressForm({
        recordedAt: p.recordedAt ? toLocalInput(p.recordedAt) : "",
        progressPercent: p.progressPercent,
        summary: p.summary,
      });
      setProgressInit({
        recordedAt: p.recordedAt ?? "",
        progressPercent: p.progressPercent,
        summary: p.summary,
      });
      setProgressDialog({ open: true, mode: "edit", id: p.id, version: p.version });
      setDialogError(null);
    } catch (err) {
      setDialogError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "重新加载失败", "NETWORK_ERROR"),
      );
    } finally {
      setSaving(false);
    }
  };

  // L2-A：acceptance submit（create POST / edit PATCH changed-only + version CAS）
  // 红线：Acceptance 是验收事实记录，ProjectAccepted 事件由 backend 负责，前端不复制事件逻辑；mutation 后 authoritative re-GET
  const submitAcceptance = async () => {
    if (!acceptanceDialog.open) return;
    if (acceptanceForm.name.trim() === "") {
      setDialogError(new ApiClientError(400, "验收项名称不能为空", "VALIDATION"));
      return;
    }
    setSaving(true);
    setDialogError(null);
    try {
      if (acceptanceDialog.mode === "create") {
        await apiFetch(`/api/projects/${id}/acceptance`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: acceptanceForm.name.trim(),
            expectedDate: acceptanceForm.expectedDate === "" ? null : toIso(acceptanceForm.expectedDate),
            actualDate: acceptanceForm.actualDate === "" ? null : toIso(acceptanceForm.actualDate),
            result: acceptanceForm.result,
            resultNote:
              acceptanceForm.resultNote.trim() === "" ? null : acceptanceForm.resultNote.trim(),
          }),
        });
      } else if (acceptanceDialog.id && acceptanceDialog.version != null && acceptanceInit) {
        // Edit PATCH 只发 changed fields；字符串字段按提交语义（normalized）比较：
        // name 用 trimmed value、resultNote 用 trim()==="" ? null : trimmedValue，
        // 与 authoritative normalized value 比较——纯空格输入不产生无意义 mutation/version increment
        const changes: Record<string, unknown> = {};
        const normalizedName = acceptanceForm.name.trim();
        if (normalizedName !== acceptanceInit.name) changes.name = normalizedName;
        if (acceptanceForm.result !== acceptanceInit.result) changes.result = acceptanceForm.result;
        const normalizedNote =
          acceptanceForm.resultNote.trim() === "" ? null : acceptanceForm.resultNote.trim();
        const initNormalizedNote =
          acceptanceInit.resultNote.trim() === "" ? null : acceptanceInit.resultNote.trim();
        if (normalizedNote !== initNormalizedNote) changes.resultNote = normalizedNote;
        const initExpectedDate =
          acceptanceInit.expectedDate === "" ? "" : toLocalInput(acceptanceInit.expectedDate);
        if (acceptanceForm.expectedDate !== initExpectedDate) {
          changes.expectedDate =
            acceptanceForm.expectedDate === "" ? null : toIso(acceptanceForm.expectedDate);
        }
        const initActualDate =
          acceptanceInit.actualDate === "" ? "" : toLocalInput(acceptanceInit.actualDate);
        if (acceptanceForm.actualDate !== initActualDate) {
          changes.actualDate =
            acceptanceForm.actualDate === "" ? null : toIso(acceptanceForm.actualDate);
        }
        if (Object.keys(changes).length === 0) {
          closeAcceptanceDialog();
          return;
        }
        await apiFetch(`/api/projects/${id}/acceptance/${acceptanceDialog.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...changes, version: acceptanceDialog.version }),
        });
      }
      closeAcceptanceDialog();
      toast.success("验收项已保存");
      await reloadProject();
    } catch (err) {
      setDialogError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "保存失败", "NETWORK_ERROR"),
      );
    } finally {
      setSaving(false);
    }
  };

  const reloadAcceptance = async () => {
    if (!acceptanceDialog.open || !acceptanceDialog.id) return;
    setSaving(true);
    try {
      const body = await apiFetch<AcceptanceRow>(
        `/api/projects/${id}/acceptance/${acceptanceDialog.id}`,
      );
      const a = body.data;
      setAcceptanceForm({
        name: a.name,
        expectedDate: a.expectedDate ? toLocalInput(a.expectedDate) : "",
        actualDate: a.actualDate ? toLocalInput(a.actualDate) : "",
        result: a.result as AcceptanceFormValue["result"],
        resultNote: a.resultNote ?? "",
      });
      setAcceptanceInit({
        name: a.name,
        expectedDate: a.expectedDate ?? "",
        actualDate: a.actualDate ?? "",
        result: a.result,
        resultNote: a.resultNote ?? "",
      });
      setAcceptanceDialog({ open: true, mode: "edit", id: a.id, version: a.version });
      setDialogError(null);
    } catch (err) {
      setDialogError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "重新加载失败", "NETWORK_ERROR"),
      );
    } finally {
      setSaving(false);
    }
  };

  const reloadTransition = async () => {
    // VERSION_CONFLICT stale panel：重新 GET → 重新消费最新 stage + version + allowedTransitions
    setTransitionDialog((prev) => ({ ...prev, saving: true, error: null }));
    try {
      const body = await apiFetch<ProjectDetail>(`/api/projects/${id}`);
      setDetail(body.data);
      setTransitionDialog({
        open: true,
        targetStage: body.data.allowedTransitions?.[0] ?? "",
        remark: "",
        saving: false,
        error: null,
      });
    } catch (err) {
      setTransitionDialog((prev) => ({
        ...prev,
        saving: false,
        error:
          err instanceof ApiClientError ? err : new ApiClientError(0, "重新加载失败", "NETWORK_ERROR"),
      }));
    }
  };

  const submitTransition = async () => {
    // fail-closed：detail 未就绪（异步加载中/失败）时不允许发起流转
    if (!detail || !transitionDialog.open || !transitionDialog.targetStage) return;
    setTransitionDialog((prev) => ({ ...prev, saving: true, error: null }));
    try {
      await apiFetch(`/api/projects/${id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetStage: transitionDialog.targetStage,
          remark: transitionDialog.remark.trim() === "" ? undefined : transitionDialog.remark.trim(),
          version: detail.version, // authoritative CAS（不本地推导 stage/version）
        }),
      });
      setTransitionDialog((prev) => ({ ...prev, open: false }));
      toast.success("阶段已流转");
      // mutation 后 authoritative re-GET（不本地 patch stage/version）
      await reloadProject();
    } catch (err) {
      setTransitionDialog((prev) => ({
        ...prev,
        saving: false,
        error:
          err instanceof ApiClientError ? err : new ApiClientError(0, "流转失败", "NETWORK_ERROR"),
      }));
    }
  };

  const openTransition = () => {
    // fail-closed：detail 未就绪时不打开 Transition 对话框
    if (!detail) return;
    setTransitionDialog({
      open: true,
      targetStage: detail.allowedTransitions?.[0] ?? "",
      remark: "",
      saving: false,
      error: null,
    });
  };
  const closeTransition = () => {
    setTransitionDialog((prev) => ({ ...prev, open: false }));
  };

  // FRT-05：结项（POST /api/projects/:id/close；version CAS；force 需双权限；409 业务阻断真实展示）
  const openClose = () => {
    if (!detail) return;
    setCloseDialog({ open: true, reason: "", force: false, saving: false, error: null });
  };
  const closeClose = () => {
    setCloseDialog((prev) => ({ ...prev, open: false }));
  };
  const submitClose = async () => {
    if (!detail || !closeDialog.open) return;
    if (closeDialog.reason.trim() === "") {
      setCloseDialog((prev) => ({
        ...prev,
        error: new ApiClientError(400, "结项原因必填", "VALIDATION"),
      }));
      return;
    }
    setCloseDialog((prev) => ({ ...prev, saving: true, error: null }));
    try {
      await apiFetch("/api/projects/" + id + "/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: closeDialog.reason.trim(),
          version: detail.version, // authoritative CAS（不本地推导 version）
          ...(closeDialog.force ? { force: true } : {}),
        }),
      });
      setCloseDialog((prev) => ({ ...prev, open: false }));
      toast.success("项目已结项");
      // mutation 后 authoritative re-GET（不本地 patch stage/version）
      await reloadProject();
    } catch (err) {
      setCloseDialog((prev) => ({
        ...prev,
        saving: false,
        error:
          err instanceof ApiClientError ? err : new ApiClientError(0, "结项失败", "NETWORK_ERROR"),
      }));
    }
  };
  // VERSION_CONFLICT stale：重新 GET → 重新消费最新 version + stage；不自动重发 close
  const reloadClose = async () => {
    setCloseDialog((prev) => ({ ...prev, saving: true, error: null }));
    try {
      const body = await apiFetch<ProjectDetail>("/api/projects/" + id);
      setDetail(body.data);
      setCloseDialog({
        open: true,
        reason: "",
        force: false,
        saving: false,
        error: null,
      });
    } catch (err) {
      setCloseDialog((prev) => ({
        ...prev,
        saving: false,
        error:
          err instanceof ApiClientError ? err : new ApiClientError(0, "重新加载失败", "NETWORK_ERROR"),
      }));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget.resource === "stakeholder") {
        await apiFetch(`/api/projects/${id}/stakeholders/${deleteTarget.id}`, { method: "DELETE" });
      } else if (deleteTarget.resource === "member") {
        await apiFetch(`/api/projects/${id}/members/${deleteTarget.id}`, { method: "DELETE" });
      } else if (deleteTarget.resource === "milestone") {
        await apiFetch(`/api/projects/${id}/milestones/${deleteTarget.id}`, { method: "DELETE" });
      } else if (deleteTarget.resource === "risk") {
        await apiFetch(`/api/projects/${id}/risks/${deleteTarget.id}`, { method: "DELETE" });
      } else if (deleteTarget.resource === "visit") {
        await apiFetch(`/api/projects/${id}/visits/${deleteTarget.id}`, { method: "DELETE" });
      } else if (deleteTarget.resource === "product") {
        await apiFetch(`/api/projects/${id}/products/${deleteTarget.id}`, { method: "DELETE" });
      } else if (deleteTarget.resource === "tag") {
        await apiFetch(`/api/projects/${id}/tags/${deleteTarget.id}`, { method: "DELETE" });
      } else if (deleteTarget.resource === "budget") {
        await apiFetch(`/api/projects/${id}/budgets/${deleteTarget.id}`, { method: "DELETE" });
      } else if (deleteTarget.resource === "expense") {
        await apiFetch(`/api/projects/${id}/expenses/${deleteTarget.id}`, { method: "DELETE" });
      } else if (deleteTarget.resource === "progress") {
        await apiFetch(`/api/projects/${id}/progress/${deleteTarget.id}`, { method: "DELETE" });
      } else if (deleteTarget.resource === "acceptance") {
        await apiFetch(`/api/projects/${id}/acceptance/${deleteTarget.id}`, { method: "DELETE" });
      } else {
        await apiFetch(`/api/projects/${id}/tasks/${deleteTarget.id}`, { method: "DELETE" });
      }
      setDeleteTarget(null);
      toast.success("已删除");
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
        <div className="border-border bg-surface shadow-elevation-sm overflow-hidden rounded-lg border">
          <PageLoading rows={5} />
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
  const canManageMilestones = detail.capabilities.milestones;
  const canAddMilestone =
    canManageMilestones &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-milestone", "create"));
  const canEditMilestone =
    canManageMilestones &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-milestone", "edit"));
  const canDeleteMilestone =
    canManageMilestones &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-milestone", "delete"));
  const canManageTasks = detail.capabilities.tasks;
  const canAddTask =
    canManageTasks &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-task", "create"));
  const canEditTask =
    canManageTasks &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-task", "edit"));
  const canDeleteTask =
    canManageTasks &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-task", "delete"));
  const canManageRisks = detail.capabilities.risks;
  const canAddRisk =
    canManageRisks &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-risk", "create"));
  const canEditRisk =
    canManageRisks &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-risk", "edit"));
  const canDeleteRisk =
    canManageRisks &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-risk", "delete"));
  const canManageVisits = detail.capabilities.visits;
  const canAddVisit =
    canManageVisits &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-visit", "create"));
  const canEditVisit =
    canManageVisits &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-visit", "edit"));
  const canDeleteVisit =
    canManageVisits &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-visit", "delete"));
  const canManageProducts = detail.capabilities.products;
  const canAddProduct =
    canManageProducts &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-product", "create")) &&
    // selector 依赖真实 Items API：缺 item:view → 不显示添加按钮（CTO #13762）
    hasPermission(roles, actionPermission("item", "view"));
  const canEditProduct =
    canManageProducts &&
    detail.stage !== "CLOSED" &&
    // Edit 不需要 item:view：item 是 aggregate authoritative relation + Edit 时 locked（CTO #13762）
    hasPermission(roles, actionPermission("project-product", "edit"));
  const canDeleteProduct =
    canManageProducts &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-product", "delete"));
  const canManageTags = detail.capabilities.tags;
  const canAddTag =
    canManageTags &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-tag", "create")) &&
    // selector 依赖真实 Tag 数据源：缺 tag:view → 不显示添加按钮（CTO #13762）
    hasPermission(roles, actionPermission("tag", "view"));
  const canDeleteTag =
    canManageTags &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-tag", "delete"));
  const canManageBudgets = detail.capabilities.budgets;
  const canAddBudget =
    canManageBudgets &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-budget", "create"));
  const canEditBudget =
    canManageBudgets &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-budget", "edit"));
  const canDeleteBudget =
    canManageBudgets &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-budget", "delete"));
  const canManageExpenses = detail.capabilities.expenses;
  const canAddExpense =
    canManageExpenses &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-expense", "create"));
  const canEditExpense =
    canManageExpenses &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-expense", "edit"));
  const canDeleteExpense =
    canManageExpenses &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-expense", "delete"));
  const canManageProgresses = detail.capabilities.progresses;
  const canAddProgress =
    canManageProgresses &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-progress", "create"));
  const canEditProgress =
    canManageProgresses &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-progress", "edit"));
  const canDeleteProgress =
    canManageProgresses &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-progress", "delete"));
  // L2-A：acceptance 三层按钮 Gate（capabilities + 细粒度 permission + stage !== CLOSED；CLOSED 后写按钮隐藏）
  const canManageAcceptances = detail.capabilities.acceptances;
  // L2-B1：Transition 入口 Gate（唯一候选来源 = detail.allowedTransitions；不复制状态机；无候选/CLOSED 不显示入口）
  const canTransition =
    canEdit &&
    detail.stage !== "CLOSED" &&
    (detail.allowedTransitions?.length ?? 0) > 0;
  // FRT-05：Close 入口 Gate（backend requirePermission("project:close")；CLOSED 后不显示；
  // force 需 project:close + project:approve 双权限（与 backend close route force 分支一致））
  const canClose =
    hasPermission(roles, actionPermission("project", "close")) && detail.stage !== "CLOSED";
  const canForceClose = hasPermission(roles, actionPermission("project", "approve"));
  const canAddAcceptance =
    canManageAcceptances &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-acceptance", "create"));
  const canEditAcceptance =
    canManageAcceptances &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-acceptance", "edit"));
  const canDeleteAcceptance =
    canManageAcceptances &&
    detail.stage !== "CLOSED" &&
    hasPermission(roles, actionPermission("project-acceptance", "delete"));

  return (
    <AppPage>
      {refreshing && (
        <div className="mb-4 text-xs text-ink-muted">正在刷新…</div>
      )}
      {refreshError && (
        <div className="border-status-warning-border mb-4 rounded-md border bg-status-warning-bg p-3 text-sm text-status-warning-text">
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
          canEdit || canClose ? (
            <div className="flex items-center gap-2">
              {canEdit && detail.stage !== "CLOSED" && (
                <Link
                  href={"/projects/" + id + "/edit"}
                  className={BUTTON_PRIMARY_CLASS}
                >
                  编辑
                </Link>
              )}
              {canTransition && (
                <button
                  type="button"
                  onClick={openTransition}
                  className={BUTTON_PRIMARY_CLASS}
                >
                  阶段流转
                </button>
              )}
              {canClose && (
                <button
                  type="button"
                  onClick={openClose}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                >
                  结项
                </button>
              )}
            </div>
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
            <InfoItem label="预计合同金额" value={formatMoneyValue(detail.expectedContractAmount)} />
            <InfoItem label="预计利润" value={formatMoneyValue(detail.expectedProfit)} />
            <InfoItem
              label="预计毛利率"
              value={detail.expectedGrossMarginRate != null ? `${detail.expectedGrossMarginRate}%` : null}
            />
            <InfoItem label="已回款金额" value={formatMoneyValue(detail.receivedAmount)} />
            <InfoItem label="应收余额" value={formatMoneyValue(detail.receivableBalance)} />
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
        {/* Tabs 导航（F2-4B1 capability-aware：capability=false 的 Tab 不出现；组合 Tab 按 OR；UI-06 动效 150ms） */}
        <div className="border-border flex flex-wrap gap-1 border-b" role="tablist" aria-label="项目详情页签">
          {TABS.filter((t) => {
            if (t.key === "overview") return true; // 核心事实始终可见
            if (t.key === "financial") return detail.capabilities.budgets || detail.capabilities.expenses || detail.capabilities.progresses;
            if (t.key === "acceptance") return detail.capabilities.acceptances || detail.capabilities.closure;
            return detail.capabilities[t.key]; // 单资源 Tab：capability=false → 不出现
          }).map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={activeTab === t.key}
              onClick={() => setActiveTab(t.key)}
              className={`-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors duration-150 ease-out ${
                activeTab === t.key
                  ? "border-brand-600 font-semibold text-brand-700"
                  : "border-transparent text-ink-secondary hover:bg-canvas hover:text-ink-primary"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="space-y-6 pt-4">

          {activeTab === "overview" && (
            <div className="space-y-6">
              <section className="rounded-lg border border-border bg-surface p-4">
                <h3 className="mb-3 text-sm font-semibold text-ink-primary">项目描述</h3>
                <p className="text-sm whitespace-pre-wrap text-ink-secondary">
                  {detail.description ?? "暂无描述"}
                </p>
              </section>
              <section className="rounded-lg border border-border bg-surface p-4">
                <h3 className="mb-3 text-sm font-semibold text-ink-primary">商务信息</h3>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <InfoItem label="预计合同金额" value={formatMoneyValue(detail.expectedContractAmount)} />
                  <InfoItem label="预计利润" value={formatMoneyValue(detail.expectedProfit)} />
                  <InfoItem
                    label="预计毛利率"
                    value={detail.expectedGrossMarginRate != null ? `${detail.expectedGrossMarginRate}%` : null}
                  />
                  <InfoItem label="已回款金额" value={formatMoneyValue(detail.receivedAmount)} />
                  <InfoItem label="应收余额" value={formatMoneyValue(detail.receivableBalance)} />
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
            <SubresourceCard
              title="项目关系人"
              count={detail.stakeholders?.length ?? 0}
              action={
                canAddStakeholder ? (
                  <button
                    type="button"
                    onClick={openStakeholderCreate}
                    className={BUTTON_PRIMARY_CLASS}
                  >
                    + 添加关系人
                  </button>
                ) : undefined
              }
            >
              <DetailTable
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
                colSpan={canEditStakeholder || canDeleteStakeholder ? 8 : 7}
                emptyText="暂无关系人"
              >
                {(detail.stakeholders ?? []).map((s) => (
                  <tr key={s.id} className="transition-colors hover:bg-brand-50/40">
                    <td className="px-4 py-3 text-ink-secondary">
                      {STAKEHOLDER_ROLE_LABELS[s.role] ?? s.role}
                    </td>
                    <td className="px-4 py-3 font-medium text-ink-primary">{s.name}</td>
                    <td className="px-4 py-3 text-ink-secondary"><TruncatedCell text={s.title} /></td>
                    <td className="px-4 py-3 text-ink-secondary"><TruncatedCell text={s.department} /></td>
                    <td className="px-4 py-3 text-ink-secondary">{s.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-secondary"><TruncatedCell text={s.email} /></td>
                    <td className="px-4 py-3 text-ink-secondary"><TruncatedCell text={s.note} /></td>
                    {(canEditStakeholder || canDeleteStakeholder) && (
                      <td className="px-4 py-3 text-right">
                        <RowActionButtons
                          onEdit={canEditStakeholder ? () => openStakeholderEdit(s) : undefined}
                          onDelete={
                            canDeleteStakeholder
                              ? () =>
                                  setDeleteTarget({ resource: "stakeholder", id: s.id, name: s.name })
                              : undefined
                          }
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </DetailTable>
            </SubresourceCard>
          )}

          {activeTab === "members" && (
            <SubresourceCard
              title="项目成员"
              count={detail.members?.length ?? 0}
              action={
                canAddMember ? (
                  <button
                    type="button"
                    onClick={openMemberCreate}
                    className={BUTTON_PRIMARY_CLASS}
                  >
                    + 添加成员
                  </button>
                ) : undefined
              }
            >
              <DetailTable
                headers={[
                  "姓名",
                  "项目内角色",
                  "加入时间",
                  "离开时间",
                  ...(canEditMember || canDeleteMember ? ["操作"] : []),
                ]}
                colSpan={canEditMember || canDeleteMember ? 5 : 4}
                emptyText="暂无成员"
              >
                {(detail.members ?? []).map((m) => (
                  <tr key={m.id} className="transition-colors hover:bg-brand-50/40">
                    <td className="px-4 py-3 font-medium text-ink-primary">{m.name}</td>
                    <td className="px-4 py-3 text-ink-secondary"><TruncatedCell text={m.roleInProject} /></td>
                    <td className="px-4 py-3 text-ink-secondary">{formatDate(m.joinedAt)}</td>
                    <td className="px-4 py-3 text-ink-secondary">{formatDate(m.leftAt)}</td>
                    {(canEditMember || canDeleteMember) && (
                      <td className="px-4 py-3 text-right">
                        <RowActionButtons
                          onEdit={canEditMember ? () => openMemberEdit(m) : undefined}
                          onDelete={
                            canDeleteMember
                              ? () => setDeleteTarget({ resource: "member", id: m.id, name: m.name })
                              : undefined
                          }
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </DetailTable>
            </SubresourceCard>
          )}

          {activeTab === "milestones" && (
            <SubresourceCard
              title="里程碑"
              count={detail.milestones?.length ?? 0}
              action={
                canAddMilestone ? (
                  <button
                    type="button"
                    onClick={openMilestoneCreate}
                    className={BUTTON_PRIMARY_CLASS}
                  >
                    + 添加里程碑
                  </button>
                ) : undefined
              }
            >
              <DetailTable
                headers={[
                  "名称",
                  "状态",
                  "计划日期",
                  "实际日期",
                  "交付成果",
                  "延期原因",
                  ...(canEditMilestone || canDeleteMilestone ? ["操作"] : []),
                ]}
                colSpan={canEditMilestone || canDeleteMilestone ? 7 : 6}
                emptyText="暂无里程碑"
              >
                {(detail.milestones ?? []).map((m) => (
                  <tr key={m.id} className="transition-colors hover:bg-brand-50/40">
                    <td className="px-4 py-3 font-medium text-ink-primary">{m.name}</td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={m.status}
                        label={MILESTONE_STATUS_LABELS[m.status] ?? m.status}
                      />
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">{formatDate(m.plannedDate)}</td>
                    <td className="px-4 py-3 text-ink-secondary">{formatDate(m.actualDate)}</td>
                    <td className="px-4 py-3 text-ink-secondary"><TruncatedCell text={m.deliverable} /></td>
                    <td className="px-4 py-3 text-ink-secondary"><TruncatedCell text={m.delayReason} /></td>
                    {(canEditMilestone || canDeleteMilestone) && (
                      <td className="px-4 py-3 text-right">
                        <RowActionButtons
                          onEdit={canEditMilestone ? () => openMilestoneEdit(m) : undefined}
                          onDelete={
                            canDeleteMilestone
                              ? () => setDeleteTarget({ resource: "milestone", id: m.id, name: m.name })
                              : undefined
                          }
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </DetailTable>
            </SubresourceCard>
          )}

          {activeTab === "tasks" && (
            <SubresourceCard
              title="任务"
              count={detail.tasks?.length ?? 0}
              action={
                canAddTask ? (
                  <button
                    type="button"
                    onClick={openTaskCreate}
                    className={BUTTON_PRIMARY_CLASS}
                  >
                    + 添加任务
                  </button>
                ) : undefined
              }
            >
              <DetailTable
                headers={[
                  "名称",
                  "状态",
                  "优先级",
                  "截止日期",
                  ...(canEditTask || canDeleteTask ? ["操作"] : []),
                ]}
                colSpan={canEditTask || canDeleteTask ? 5 : 4}
                emptyText="暂无任务"
              >
                {(detail.tasks ?? []).map((t) => (
                  <tr key={t.id} className="transition-colors hover:bg-brand-50/40">
                    <td className="px-4 py-3 font-medium text-ink-primary"><TruncatedCell text={t.name} maxWidth="max-w-[14rem]" /></td>
                    <td className="px-4 py-3">
                      <StatusBadge status={t.status} label={TASK_STATUS_LABELS[t.status] ?? t.status} />
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">
                      {t.priority ? PRIORITY_LABELS[t.priority] ?? t.priority : "—"}
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">{formatDate(t.dueDate)}</td>
                    {(canEditTask || canDeleteTask) && (
                      <td className="px-4 py-3 text-right">
                        <RowActionButtons
                          onEdit={canEditTask ? () => openTaskEdit(t) : undefined}
                          onDelete={
                            canDeleteTask
                              ? () => setDeleteTarget({ resource: "task", id: t.id, name: t.name })
                              : undefined
                          }
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </DetailTable>
            </SubresourceCard>
          )}

          {activeTab === "products" && (
            <SubresourceCard
              title="产品"
              count={detail.products?.length ?? 0}
              action={
                canAddProduct ? (
                  <button
                    type="button"
                    onClick={openProductCreate}
                    className={BUTTON_PRIMARY_CLASS}
                  >
                    + 添加产品
                  </button>
                ) : undefined
              }
            >
              <DetailTable
                headers={[
                  "物料编码",
                  "物料名称",
                  "型号",
                  { text: "数量", align: "right" },
                  { text: "单价", align: "right" },
                  "备注",
                  ...(canEditProduct || canDeleteProduct ? ["操作"] : []),
                ]}
                colSpan={canEditProduct || canDeleteProduct ? 7 : 6}
                emptyText="暂无产品"
              >
                {(detail.products ?? []).map((p) => (
                  <tr key={p.id} className="transition-colors hover:bg-brand-50/40">
                    <td className="px-4 py-3 text-ink-secondary">{p.item?.code ?? "—"}</td>
                    <td className="px-4 py-3 font-medium text-ink-primary">{p.item?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-secondary">{p.item?.model ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-primary">{p.quantity ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-primary">{formatMoneyValue(p.unitPrice)}</td>
                    <td className="px-4 py-3 text-ink-secondary"><TruncatedCell text={p.note} /></td>
                    {(canEditProduct || canDeleteProduct) && (
                      <td className="px-4 py-3 text-right">
                        <RowActionButtons
                          onEdit={canEditProduct ? () => openProductEdit(p) : undefined}
                          onDelete={
                            canDeleteProduct
                              ? () =>
                                  setDeleteTarget({
                                    resource: "product",
                                    id: p.id,
                                    name: `${p.item?.code ?? ""} ${p.item?.name ?? ""}`.trim() || "产品",
                                  })
                              : undefined
                          }
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </DetailTable>
            </SubresourceCard>
          )}

          {activeTab === "risks" && (
            <SubresourceCard
              title="风险"
              count={detail.risks?.length ?? 0}
              action={
                canAddRisk ? (
                  <button
                    type="button"
                    onClick={openRiskCreate}
                    className={BUTTON_PRIMARY_CLASS}
                  >
                    + 添加风险
                  </button>
                ) : undefined
              }
            >
              <DetailTable
                headers={[
                  "描述",
                  "状态",
                  "概率",
                  "影响",
                  "应对方案",
                  ...(canEditRisk || canDeleteRisk ? ["操作"] : []),
                ]}
                colSpan={canEditRisk || canDeleteRisk ? 6 : 5}
                emptyText="暂无风险"
              >
                {(detail.risks ?? []).map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-brand-50/40">
                    <td className="px-4 py-3 font-medium text-ink-primary"><TruncatedCell text={r.description} maxWidth="max-w-[14rem]" /></td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} label={RISK_STATUS_LABELS[r.status] ?? r.status} />
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">
                      {r.probability ? RISK_PROBABILITY_LABELS[r.probability] ?? r.probability : "—"}
                    </td>
                    <td className="px-4 py-3 text-ink-secondary"><TruncatedCell text={r.impact} maxWidth="max-w-[10rem]" /></td>
                    <td className="px-4 py-3 text-ink-secondary"><TruncatedCell text={r.mitigation} maxWidth="max-w-[14rem]" /></td>
                    {(canEditRisk || canDeleteRisk) && (
                      <td className="px-4 py-3 text-right">
                        <RowActionButtons
                          onEdit={canEditRisk ? () => openRiskEdit(r) : undefined}
                          onDelete={
                            canDeleteRisk
                              ? () => setDeleteTarget({ resource: "risk", id: r.id, name: r.description })
                              : undefined
                          }
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </DetailTable>
            </SubresourceCard>
          )}

          {activeTab === "visits" && (
            <SubresourceCard
              title="走访"
              count={detail.visits?.length ?? 0}
              action={
                canAddVisit ? (
                  <button
                    type="button"
                    onClick={openVisitCreate}
                    className={BUTTON_PRIMARY_CLASS}
                  >
                    + 添加走访
                  </button>
                ) : undefined
              }
            >
              <DetailTable
                headers={[
                  "类型",
                  "走访时间",
                  "客户联系人",
                  "沟通纪要",
                  "下次行动",
                  ...(canEditVisit || canDeleteVisit ? ["操作"] : []),
                ]}
                colSpan={canEditVisit || canDeleteVisit ? 6 : 5}
                emptyText="暂无走访记录"
              >
                {(detail.visits ?? []).map((v) => (
                  <tr key={v.id} className="transition-colors hover:bg-brand-50/40">
                    <td className="px-4 py-3 text-ink-secondary">
                      {VISIT_TYPE_LABELS[v.visitType] ?? v.visitType}
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">{formatDate(v.visitedAt)}</td>
                    <td className="px-4 py-3 text-ink-secondary">{v.contactName ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-secondary"><TruncatedCell text={v.summary} maxWidth="max-w-[14rem]" /></td>
                    <td className="px-4 py-3 text-ink-secondary"><TruncatedCell text={v.nextAction} maxWidth="max-w-[12rem]" /></td>
                    {(canEditVisit || canDeleteVisit) && (
                      <td className="px-4 py-3 text-right">
                        <RowActionButtons
                          onEdit={canEditVisit ? () => openVisitEdit(v) : undefined}
                          onDelete={
                            canDeleteVisit
                              ? () =>
                                  setDeleteTarget({
                                    resource: "visit",
                                    id: v.id,
                                    name: v.summary ?? v.visitType,
                                  })
                              : undefined
                          }
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </DetailTable>
            </SubresourceCard>
          )}

          {activeTab === "financial" && (
            <div className="space-y-6">
              {detail.capabilities.budgets && (
                <SubresourceCard
                  title="预算"
                  count={detail.budgets?.length ?? 0}
                  action={
                    canAddBudget ? (
                      <button
                        type="button"
                        onClick={openBudgetCreate}
                        className={BUTTON_PRIMARY_CLASS}
                      >
                        + 添加预算
                      </button>
                    ) : undefined
                  }
                >
                  <DetailTable
                    headers={[
                      "科目",
                      { text: "金额", align: "right" },
                      "币种",
                      "备注",
                      ...(canEditBudget || canDeleteBudget ? ["操作"] : []),
                    ]}
                    colSpan={canEditBudget || canDeleteBudget ? 5 : 4}
                    emptyText="暂无预算"
                  >
                    {(detail.budgets ?? []).map((b) => (
                      <tr key={b.id} className="transition-colors hover:bg-brand-50/40">
                        <td className="px-4 py-3 font-medium text-ink-primary">{b.category}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink-primary">{formatMoneyValue(b.amount)}</td>
                        <td className="px-4 py-3 text-ink-secondary">{b.currency}</td>
                        <td className="px-4 py-3 text-ink-secondary"><TruncatedCell text={b.note} /></td>
                        {(canEditBudget || canDeleteBudget) && (
                          <td className="px-4 py-3 text-right">
                            <RowActionButtons
                              onEdit={canEditBudget ? () => openBudgetEdit(b) : undefined}
                              onDelete={
                                canDeleteBudget
                                  ? () =>
                                      setDeleteTarget({
                                        resource: "budget",
                                        id: b.id,
                                        name: b.category,
                                      })
                                  : undefined
                              }
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                  </DetailTable>
                </SubresourceCard>
              )}
              {detail.capabilities.expenses && (
                <SubresourceCard
                  title="费用"
                  count={detail.expenses?.length ?? 0}
                  action={
                    canAddExpense ? (
                      <button
                        type="button"
                        onClick={openExpenseCreate}
                        className={BUTTON_PRIMARY_CLASS}
                      >
                        + 添加费用
                      </button>
                    ) : undefined
                  }
                >
                  <DetailTable
                    headers={[
                      "科目",
                      { text: "金额", align: "right" },
                      "币种",
                      "发生时间",
                      "备注",
                      ...(canEditExpense || canDeleteExpense ? ["操作"] : []),
                    ]}
                    colSpan={canEditExpense || canDeleteExpense ? 6 : 5}
                    emptyText="暂无费用"
                  >
                    {(detail.expenses ?? []).map((e) => (
                      <tr key={e.id} className="transition-colors hover:bg-brand-50/40">
                        <td className="px-4 py-3 font-medium text-ink-primary">{e.category}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink-primary">{formatMoneyValue(e.amount)}</td>
                        <td className="px-4 py-3 text-ink-secondary">{e.currency}</td>
                        <td className="px-4 py-3 text-ink-secondary">{formatDate(e.incurredAt)}</td>
                        <td className="px-4 py-3 text-ink-secondary"><TruncatedCell text={e.note} /></td>
                        {(canEditExpense || canDeleteExpense) && (
                          <td className="px-4 py-3 text-right">
                            <RowActionButtons
                              onEdit={canEditExpense ? () => openExpenseEdit(e) : undefined}
                              onDelete={
                                canDeleteExpense
                                  ? () =>
                                      setDeleteTarget({
                                        resource: "expense",
                                        id: e.id,
                                        name: e.category,
                                      })
                                  : undefined
                              }
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                  </DetailTable>
                </SubresourceCard>
              )}
              {detail.capabilities.progresses && (
                <SubresourceCard
                  title="进度记录"
                  count={detail.progresses?.length ?? 0}
                  action={
                    canAddProgress ? (
                      <button
                        type="button"
                        onClick={openProgressCreate}
                        className={BUTTON_PRIMARY_CLASS}
                      >
                        + 添加进度
                      </button>
                    ) : undefined
                  }
                >
                  <DetailTable
                    headers={[
                      "记录时间",
                      { text: "进度", align: "right" },
                      "进展说明",
                      ...(canEditProgress || canDeleteProgress ? ["操作"] : []),
                    ]}
                    colSpan={canEditProgress || canDeleteProgress ? 4 : 3}
                    emptyText="暂无进度记录"
                  >
                    {(detail.progresses ?? []).map((p) => (
                      <tr key={p.id} className="transition-colors hover:bg-brand-50/40">
                        <td className="px-4 py-3 text-ink-secondary">{formatDate(p.recordedAt)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink-primary">{p.progressPercent}%</td>
                        <td className="px-4 py-3 text-ink-secondary"><TruncatedCell text={p.summary} maxWidth="max-w-[20rem]" /></td>
                        {(canEditProgress || canDeleteProgress) && (
                          <td className="px-4 py-3 text-right">
                            <RowActionButtons
                              onEdit={canEditProgress ? () => openProgressEdit(p) : undefined}
                              onDelete={
                                canDeleteProgress
                                  ? () =>
                                      setDeleteTarget({
                                        resource: "progress",
                                        id: p.id,
                                        name: p.summary,
                                      })
                                  : undefined
                              }
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                  </DetailTable>
                </SubresourceCard>
              )}
            </div>
          )}

          {activeTab === "acceptance" && (
            <div className="space-y-6">
              {detail.capabilities.acceptances && (
                <SubresourceCard
                  title="验收项"
                  count={detail.acceptances?.length ?? 0}
                  action={
                    canAddAcceptance ? (
                      <button
                        type="button"
                        onClick={openAcceptanceCreate}
                        className={BUTTON_PRIMARY_CLASS}
                      >
                        + 添加验收项
                      </button>
                    ) : undefined
                  }
                >
                  <DetailTable
                    headers={[
                      "验收项",
                      "计划日期",
                      "实际日期",
                      "结果",
                      "结果说明",
                      ...(canEditAcceptance || canDeleteAcceptance ? ["操作"] : []),
                    ]}
                    colSpan={canEditAcceptance || canDeleteAcceptance ? 6 : 5}
                    emptyText="暂无验收项"
                  >
                    {(detail.acceptances ?? []).map((a) => (
                      <tr key={a.id} className="transition-colors hover:bg-brand-50/40">
                        <td className="px-4 py-3 font-medium text-ink-primary"><TruncatedCell text={a.name} maxWidth="max-w-[14rem]" /></td>
                        <td className="px-4 py-3 text-ink-secondary">{formatDate(a.expectedDate)}</td>
                        <td className="px-4 py-3 text-ink-secondary">{formatDate(a.actualDate)}</td>
                        <td className="px-4 py-3">
                          <StatusBadge
                            status={a.result}
                            label={ACCEPTANCE_RESULT_LABELS[a.result] ?? a.result}
                            tone={ACCEPTANCE_TONE_MAP[a.result] ?? "neutral"}
                          />
                        </td>
                        <td className="px-4 py-3 text-ink-secondary"><TruncatedCell text={a.resultNote} maxWidth="max-w-[14rem]" /></td>
                        {(canEditAcceptance || canDeleteAcceptance) && (
                          <td className="px-4 py-3 text-right">
                            <RowActionButtons
                              onEdit={canEditAcceptance ? () => openAcceptanceEdit(a) : undefined}
                              onDelete={
                                canDeleteAcceptance
                                  ? () =>
                                      setDeleteTarget({ resource: "acceptance", id: a.id, name: a.name })
                                  : undefined
                              }
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                  </DetailTable>
                </SubresourceCard>
              )}
              {detail.capabilities.closure && detail.closure && (
                <section className="rounded-lg border border-border bg-surface p-4">
                  <h3 className="mb-3 text-sm font-semibold text-ink-primary">结项</h3>
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    <InfoItem label="结项时间" value={formatDate(detail.closure.closedAt)} />
                    <InfoItem label="结项原因" value={<TruncatedCell text={detail.closure.reason} maxWidth="max-w-[16rem]" />} />
                  </div>
                </section>
              )}
            </div>
          )}

          {activeTab === "tags" && (
            <SubresourceCard
              title="标签"
              count={detail.tags?.length ?? 0}
              action={
                canAddTag ? (
                  <button
                    type="button"
                    onClick={openTagCreate}
                    className={BUTTON_PRIMARY_CLASS}
                  >
                    + 添加标签
                  </button>
                ) : undefined
              }
            >
              <div className="flex flex-wrap gap-2 px-4 py-4">
                {(detail.tags ?? []).map((t) => (
                  <span
                    key={t.id}
                    className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm text-ink-secondary"
                    style={{
                      backgroundColor: t.tag?.color ? `${t.tag.color}1a` : undefined,
                      borderColor: t.tag?.color ?? undefined,
                    }}
                  >
                    {t.tag?.name ?? t.tag?.code ?? "—"}
                    {canDeleteTag && (
                      <button
                        type="button"
                        onClick={() =>
                          setDeleteTarget({
                            resource: "tag",
                            id: t.id,
                            name: t.tag?.name ?? t.tag?.code ?? "标签",
                          })
                        }
                        aria-label="删除标签"
                        className="ml-1 rounded p-0.5 text-xs text-status-danger-text transition-colors hover:bg-red-50"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </span>
                ))}
                {(detail.tags ?? []).length === 0 && (
                  <p className="text-sm text-ink-muted">暂无标签</p>
                )}
              </div>
            </SubresourceCard>
          )}
        </div>
      </EntityDetailWorkspace>

      {/* B2-1A：共享 Dialog（Stakeholders / Members / Milestones / Tasks）+ Delete 确认（CTO #12350/#12368/#12422/#12446/#12452） */}
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

      <ProjectSubresourceDialog
        open={milestoneDialog.open}
        mode={milestoneDialog.mode}
        title={milestoneDialog.mode === "create" ? "添加里程碑" : "编辑里程碑"}
        saving={saving}
        error={dialogError}
        onSubmit={submitMilestone}
        onReload={reloadMilestone}
        onClose={closeMilestoneDialog}
      >
        <MilestoneFields
          value={milestoneForm}
          onChange={setMilestoneForm}
          statusLabels={MILESTONE_STATUS_LABELS}
        />
      </ProjectSubresourceDialog>

      <ProjectSubresourceDialog
        open={taskDialog.open}
        mode={taskDialog.mode}
        title={taskDialog.mode === "create" ? "添加任务" : "编辑任务"}
        saving={saving}
        error={dialogError}
        onSubmit={submitTask}
        onReload={reloadTask}
        onClose={closeTaskDialog}
      >
        <TaskFields
          value={taskForm}
          onChange={setTaskForm}
          statusLabels={TASK_STATUS_LABELS}
          priorityLabels={PRIORITY_LABELS}
          milestoneOptions={(detail.milestones ?? []).map((m) => ({ id: m.id, name: m.name }))}
          unavailableMilestone={
            taskDialog.mode === "edit" &&
            taskForm.milestoneId !== "" &&
            !(detail.milestones ?? []).some((m) => m.id === taskForm.milestoneId)
              ? { id: taskForm.milestoneId, label: "原关联里程碑不可用" }
              : null
          }
        />
      </ProjectSubresourceDialog>

      <ProjectSubresourceDialog
        open={riskDialog.open}
        mode={riskDialog.mode}
        title={riskDialog.mode === "create" ? "添加风险" : "编辑风险"}
        saving={saving}
        error={dialogError}
        onSubmit={submitRisk}
        onReload={reloadRisk}
        onClose={closeRiskDialog}
      >
        <RiskFields
          value={riskForm}
          onChange={setRiskForm}
          statusLabels={RISK_STATUS_LABELS}
          probabilityLabels={RISK_PROBABILITY_LABELS}
        />
      </ProjectSubresourceDialog>

      <ProjectSubresourceDialog
        open={visitDialog.open}
        mode={visitDialog.mode}
        title={visitDialog.mode === "create" ? "添加走访记录" : "编辑走访记录"}
        saving={saving}
        error={dialogError}
        onSubmit={submitVisit}
        onReload={reloadVisit}
        onClose={closeVisitDialog}
      >
        <VisitFields
          value={visitForm}
          onChange={setVisitForm}
          visitTypeLabels={VISIT_TYPE_LABELS}
        />
      </ProjectSubresourceDialog>

      <ProjectSubresourceDialog
        open={productDialog.open}
        mode={productDialog.mode}
        title={productDialog.mode === "create" ? "添加产品" : "编辑产品"}
        saving={saving}
        error={dialogError}
        onSubmit={submitProduct}
        onReload={reloadProduct}
        onClose={closeProductDialog}
        submitDisabled={
          // selector 失败/加载中 → Save disabled（CTO #13762）
          productDialog.mode === "create" && (itemOptionsLoading || itemOptionsError !== null)
        }
      >
        <ProductFields
          value={productForm}
          onChange={setProductForm}
          itemOptions={itemOptions}
          loading={itemOptionsLoading}
          error={itemOptionsError ? itemOptionsError.message : null}
          itemLocked={
            productDialog.mode === "edit" && productForm.itemId !== ""
              ? (() => {
                  const p = (detail.products ?? []).find((x) => x.id === productDialog.id);
                  const item = p?.item;
                  const label = item
                    ? `${item.code ?? ""} ${item.name ?? ""}`.trim()
                    : "";
                  return { id: productForm.itemId, label: label || productForm.itemId };
                })()
              : null
          }
        />
      </ProjectSubresourceDialog>

      <ProjectSubresourceDialog
        open={tagDialog.open}
        mode="create"
        title="添加标签"
        saving={saving}
        error={dialogError}
        onSubmit={submitTag}
        onClose={closeTagDialog}
        submitDisabled={
          // selector 失败/加载中 → Save disabled（CTO #13762）
          tagOptionsLoading || tagOptionsError !== null
        }
      >
        <TagFields
          value={tagForm}
          onChange={setTagForm}
          tagOptions={tagOptions}
          loading={tagOptionsLoading}
          error={tagOptionsError ? tagOptionsError.message : null}
          duplicateHint={
            tagForm.tagId !== "" &&
            (detail.tags ?? []).some((t) => t.tag?.id === tagForm.tagId)
              ? "该标签已添加，重复添加会被后端拒绝（409）。"
              : null
          }
        />
      </ProjectSubresourceDialog>

      <ProjectSubresourceDialog
        open={budgetDialog.open}
        mode={budgetDialog.mode}
        title={budgetDialog.mode === "create" ? "添加预算" : "编辑预算"}
        saving={saving}
        error={dialogError}
        onSubmit={submitBudget}
        onReload={reloadBudget}
        onClose={closeBudgetDialog}
      >
        <BudgetFields value={budgetForm} onChange={setBudgetForm} />
      </ProjectSubresourceDialog>

      <ProjectSubresourceDialog
        open={expenseDialog.open}
        mode={expenseDialog.mode}
        title={expenseDialog.mode === "create" ? "添加费用" : "编辑费用"}
        saving={saving}
        error={dialogError}
        onSubmit={submitExpense}
        onReload={reloadExpense}
        onClose={closeExpenseDialog}
      >
        <ExpenseFields value={expenseForm} onChange={setExpenseForm} />
      </ProjectSubresourceDialog>

      <ProjectSubresourceDialog
        open={progressDialog.open}
        mode={progressDialog.mode}
        title={progressDialog.mode === "create" ? "添加进度" : "编辑进度"}
        saving={saving}
        error={dialogError}
        onSubmit={submitProgress}
        onReload={reloadProgress}
        onClose={closeProgressDialog}
      >
        <ProgressFields value={progressForm} onChange={setProgressForm} />
      </ProjectSubresourceDialog>

      <ProjectSubresourceDialog
        open={acceptanceDialog.open}
        mode={acceptanceDialog.mode}
        title={acceptanceDialog.mode === "create" ? "添加验收项" : "编辑验收项"}
        saving={saving}
        error={dialogError}
        onSubmit={submitAcceptance}
        onReload={reloadAcceptance}
        onClose={closeAcceptanceDialog}
      >
        <AcceptanceFields value={acceptanceForm} onChange={setAcceptanceForm} resultLabels={ACCEPTANCE_RESULT_LABELS} />
      </ProjectSubresourceDialog>

      {/* L2-B1：Transition command dialog（唯一候选来源 = detail.allowedTransitions；不复制状态机；CLOSED/无候选不显示入口） */}
      {transitionDialog.open && (
        <div
          role="dialog"
          aria-modal="true"
          className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4 backdrop-blur-[2px]"
          onClick={closeTransition}
        >
          <div
            className="animate-dialog-in border-border bg-surface shadow-elevation-lg w-full max-w-md rounded-lg border p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-ink-primary text-base font-semibold">阶段流转</h2>
            <p className="text-ink-secondary mt-1 text-sm">
              当前阶段：{STAGE_LABELS[detail.stage] ?? detail.stage}
            </p>
            <div className="mt-4">
              <label className="text-ink-secondary block text-xs font-medium">目标阶段 *</label>
              <select
                value={transitionDialog.targetStage}
                onChange={(e) =>
                  setTransitionDialog((prev) => ({ ...prev, targetStage: e.target.value }))
                }
                className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
              >
                {(detail.allowedTransitions ?? []).map((code) => (
                  <option key={code} value={code}>
                    {STAGE_LABELS[code] ?? code}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-3">
              <label className="text-ink-secondary block text-xs font-medium">备注（可选）</label>
              <input
                value={transitionDialog.remark}
                onChange={(e) =>
                  setTransitionDialog((prev) => ({ ...prev, remark: e.target.value }))
                }
                maxLength={500}
                className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
              />
            </div>
            {transitionDialog.error && (
              <div className="border-status-danger-border mt-3 rounded-md border bg-status-danger-bg p-3 text-sm text-status-danger-text">
                <p>
                  {describeStatus(transitionDialog.error.status)}：{transitionDialog.error.message}
                  {transitionDialog.error.code ? `（${transitionDialog.error.code}）` : ""}
                </p>
                {transitionDialog.error.code === "VERSION_CONFLICT" && (
                  <div className="mt-2">
                    <p className="text-xs">该记录已被其他操作更新，请重新加载最新数据后再操作。</p>
                    <button
                      type="button"
                      onClick={reloadTransition}
                      disabled={transitionDialog.saving}
                      className={"mt-2 " + BUTTON_PRIMARY_CLASS}
                    >
                      重新加载
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeTransition}
                disabled={transitionDialog.saving}
                className={BUTTON_SECONDARY_CLASS + " disabled:cursor-not-allowed disabled:opacity-50"}
              >
                取消
              </button>
              <button
                type="button"
                onClick={submitTransition}
                disabled={transitionDialog.saving || !transitionDialog.targetStage}
                className="bg-brand-600 hover:bg-brand-700 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {transitionDialog.saving ? "处理中…" : "确认流转"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FRT-05：Close command dialog（消费 backend POST /api/projects/:id/close：
  reason 必填 + version CAS；force 仅 canForceClose 可见；VERSION_CONFLICT → 重新加载） */}
      {closeDialog.open && (
        <div
          role="dialog"
          aria-modal="true"
          className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4 backdrop-blur-[2px]"
          onClick={closeClose}
        >
          <div
            className="animate-dialog-in border-border bg-surface shadow-elevation-lg w-full max-w-md rounded-lg border p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-ink-primary text-base font-semibold">项目结项</h2>
            <p className="text-ink-secondary mt-1 text-sm">
              结项后将锁定项目关键字段（stage 置为 CLOSED）。
            </p>
            <div className="mt-4">
              <label className="text-ink-secondary block text-xs font-medium">结项原因 *</label>
              <textarea
                value={closeDialog.reason}
                onChange={(e) =>
                  setCloseDialog((prev) => ({ ...prev, reason: e.target.value }))
                }
                maxLength={500}
                rows={3}
                placeholder="必填（最长 500 字）"
                className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
              />
            </div>
            {canForceClose && (
              <label className="mt-3 flex items-center gap-2 text-sm text-ink-secondary">
                <input
                  type="checkbox"
                  checked={closeDialog.force}
                  onChange={(e) =>
                    setCloseDialog((prev) => ({ ...prev, force: e.target.checked }))
                  }
                  className="h-4 w-4"
                />
                强制结项（需 project:close + project:approve；跳过未完成任务/风险/验收/回款阻断）
              </label>
            )}
            {closeDialog.error && (
              <div className="border-status-danger-border mt-3 rounded-md border bg-status-danger-bg p-3 text-sm text-status-danger-text">
                <p>
                  {describeStatus(closeDialog.error.status)}：{closeDialog.error.message}
                  {closeDialog.error.code ? "（" + closeDialog.error.code + "）" : ""}
                </p>
                {closeDialog.error.code === "VERSION_CONFLICT" && (
                  <div className="mt-2">
                    <p className="text-xs">该记录已被其他操作更新，请重新加载最新数据后再操作。</p>
                    <button
                      type="button"
                      onClick={reloadClose}
                      disabled={closeDialog.saving}
                      className={"mt-2 " + BUTTON_PRIMARY_CLASS}
                    >
                      重新加载
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeClose}
                disabled={closeDialog.saving}
                className={BUTTON_SECONDARY_CLASS + " disabled:cursor-not-allowed disabled:opacity-50"}
              >
                取消
              </button>
              <button
                type="button"
                onClick={submitClose}
                disabled={closeDialog.saving || closeDialog.reason.trim() === ""}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {closeDialog.saving ? "处理中…" : "确认结项"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmActionDialog
        open={deleteTarget !== null}
        title={
          deleteTarget
            ? `删除${SUBRESOURCE_LABELS[deleteTarget.resource] ?? deleteTarget.resource}「${deleteTarget.name}」？`
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
    <PermissionGuard permission={actionPermission("project", "view")}>
      <ProjectDetailPage />
    </PermissionGuard>
  );
}
