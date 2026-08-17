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
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
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

const RISK_PROBABILITY_LABELS: Record<string, string> = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
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

const SUBRESOURCE_LABELS: Record<string, string> = {
  stakeholder: "关系人",
  member: "成员",
  milestone: "里程碑",
  task: "任务",
  risk: "风险",
  visit: "走访记录",
  product: "产品",
  tag: "标签",
  budget: "预算",
  expense: "费用",
  progress: "进度记录",
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

/** B2-2B：datetime-local 时区转换纪律（不 slice UTC ISO 冒充本地时间）
 * toLocalInput：ISO UTC → 本地 datetime-local（YYYY-MM-DDTHH:mm）
 * toIso：datetime-local 本地时间 → Date → ISO UTC
 */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toIso(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
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
      | "progress";
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
      visitedAt: v.visitedAt ? v.visitedAt.slice(0, 16) : "",
      contactName: v.contactName ?? "",
      summary: v.summary ?? "",
      nextAction: v.nextAction ?? "",
      reminderAt: v.reminderAt ? v.reminderAt.slice(0, 16) : "",
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
        visitedAt: v.visitedAt ? v.visitedAt.slice(0, 16) : "",
        contactName: v.contactName ?? "",
        summary: v.summary ?? "",
        nextAction: v.nextAction ?? "",
        reminderAt: v.reminderAt ? v.reminderAt.slice(0, 16) : "",
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
      } else {
        await apiFetch(`/api/projects/${id}/tasks/${deleteTarget.id}`, { method: "DELETE" });
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

  return (
    <AppPage>
      {refreshing && (
        <div className="mb-4 text-xs text-ink-muted">正在刷新…</div>
      )}
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
              <div className="mb-3 flex items-center justify-between">
                <SectionTitle>里程碑（{detail.milestones?.length ?? 0}）</SectionTitle>
                {canAddMilestone && (
                  <button
                    type="button"
                    onClick={openMilestoneCreate}
                    className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    添加里程碑
                  </button>
                )}
              </div>
              <Table
                headers={[
                  "名称",
                  "状态",
                  "计划日期",
                  "实际日期",
                  "交付成果",
                  "延期原因",
                  ...(canEditMilestone || canDeleteMilestone ? ["操作"] : []),
                ]}
              >
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
                    {(canEditMilestone || canDeleteMilestone) && (
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          {canEditMilestone && (
                            <button
                              type="button"
                              onClick={() => openMilestoneEdit(m)}
                              className="text-brand-600 text-sm hover:underline"
                            >
                              编辑
                            </button>
                          )}
                          {canDeleteMilestone && (
                            <button
                              type="button"
                              onClick={() =>
                                setDeleteTarget({ resource: "milestone", id: m.id, name: m.name })
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
                {(detail.milestones ?? []).length === 0 && (
                  <EmptyRow
                    colSpan={canEditMilestone || canDeleteMilestone ? 7 : 6}
                    text="暂无里程碑"
                  />
                )}
              </Table>
            </section>
          )}

          {activeTab === "tasks" && (
            <section className="border-border rounded-md border p-4">
              <div className="mb-3 flex items-center justify-between">
                <SectionTitle>任务（{detail.tasks?.length ?? 0}）</SectionTitle>
                {canAddTask && (
                  <button
                    type="button"
                    onClick={openTaskCreate}
                    className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    添加任务
                  </button>
                )}
              </div>
              <Table
                headers={[
                  "名称",
                  "状态",
                  "优先级",
                  "截止日期",
                  ...(canEditTask || canDeleteTask ? ["操作"] : []),
                ]}
              >
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
                    {(canEditTask || canDeleteTask) && (
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          {canEditTask && (
                            <button
                              type="button"
                              onClick={() => openTaskEdit(t)}
                              className="text-brand-600 text-sm hover:underline"
                            >
                              编辑
                            </button>
                          )}
                          {canDeleteTask && (
                            <button
                              type="button"
                              onClick={() =>
                                setDeleteTarget({ resource: "task", id: t.id, name: t.name })
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
                {(detail.tasks ?? []).length === 0 && (
                  <EmptyRow colSpan={canEditTask || canDeleteTask ? 5 : 4} text="暂无任务" />
                )}
              </Table>
            </section>
          )}

          {activeTab === "products" && (
            <section className="border-border rounded-md border p-4">
              <div className="mb-3 flex items-center justify-between">
                <SectionTitle>产品（{detail.products?.length ?? 0}）</SectionTitle>
                {canAddProduct && (
                  <button
                    type="button"
                    onClick={openProductCreate}
                    className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    添加产品
                  </button>
                )}
              </div>
              <Table
                headers={[
                  "物料编码",
                  "物料名称",
                  "型号",
                  "数量",
                  "单价",
                  "备注",
                  ...(canEditProduct || canDeleteProduct ? ["操作"] : []),
                ]}
              >
                {(detail.products ?? []).map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2 text-ink-secondary">{p.item?.code ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-primary">{p.item?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{p.item?.model ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-primary">{p.quantity ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{p.unitPrice ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{p.note ?? "—"}</td>
                    {(canEditProduct || canDeleteProduct) && (
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          {canEditProduct && (
                            <button
                              type="button"
                              onClick={() => openProductEdit(p)}
                              className="text-brand-600 text-sm hover:underline"
                            >
                              编辑
                            </button>
                          )}
                          {canDeleteProduct && (
                            <button
                              type="button"
                              onClick={() =>
                                setDeleteTarget({
                                  resource: "product",
                                  id: p.id,
                                  name: `${p.item?.code ?? ""} ${p.item?.name ?? ""}`.trim() || "产品",
                                })
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
                {(detail.products ?? []).length === 0 && (
                  <EmptyRow colSpan={canEditProduct || canDeleteProduct ? 7 : 6} text="暂无产品" />
                )}
              </Table>
            </section>
          )}

          {activeTab === "risks" && (
            <section className="border-border rounded-md border p-4">
              <div className="mb-3 flex items-center justify-between">
                <SectionTitle>风险（{detail.risks?.length ?? 0}）</SectionTitle>
                {canAddRisk && (
                  <button
                    type="button"
                    onClick={openRiskCreate}
                    className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    添加风险
                  </button>
                )}
              </div>
              <Table
                headers={[
                  "描述",
                  "状态",
                  "概率",
                  "影响",
                  "应对方案",
                  ...(canEditRisk || canDeleteRisk ? ["操作"] : []),
                ]}
              >
                {(detail.risks ?? []).map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 text-ink-primary">{r.description}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} label={RISK_STATUS_LABELS[r.status] ?? r.status} />
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">
                      {r.probability ? RISK_PROBABILITY_LABELS[r.probability] ?? r.probability : "—"}
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{r.impact ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{r.mitigation ?? "—"}</td>
                    {(canEditRisk || canDeleteRisk) && (
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          {canEditRisk && (
                            <button
                              type="button"
                              onClick={() => openRiskEdit(r)}
                              className="text-brand-600 text-sm hover:underline"
                            >
                              编辑
                            </button>
                          )}
                          {canDeleteRisk && (
                            <button
                              type="button"
                              onClick={() =>
                                setDeleteTarget({ resource: "risk", id: r.id, name: r.description })
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
                {(detail.risks ?? []).length === 0 && (
                  <EmptyRow colSpan={canEditRisk || canDeleteRisk ? 6 : 5} text="暂无风险" />
                )}
              </Table>
            </section>
          )}

          {activeTab === "visits" && (
            <section className="border-border rounded-md border p-4">
              <div className="mb-3 flex items-center justify-between">
                <SectionTitle>走访（{detail.visits?.length ?? 0}）</SectionTitle>
                {canAddVisit && (
                  <button
                    type="button"
                    onClick={openVisitCreate}
                    className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    添加走访
                  </button>
                )}
              </div>
              <Table
                headers={[
                  "类型",
                  "走访时间",
                  "客户联系人",
                  "沟通纪要",
                  "下次行动",
                  ...(canEditVisit || canDeleteVisit ? ["操作"] : []),
                ]}
              >
                {(detail.visits ?? []).map((v) => (
                  <tr key={v.id}>
                    <td className="px-3 py-2 text-ink-secondary">
                      {VISIT_TYPE_LABELS[v.visitType] ?? v.visitType}
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{formatDate(v.visitedAt)}</td>
                    <td className="px-3 py-2 text-ink-secondary">{v.contactName ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{v.summary ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{v.nextAction ?? "—"}</td>
                    {(canEditVisit || canDeleteVisit) && (
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          {canEditVisit && (
                            <button
                              type="button"
                              onClick={() => openVisitEdit(v)}
                              className="text-brand-600 text-sm hover:underline"
                            >
                              编辑
                            </button>
                          )}
                          {canDeleteVisit && (
                            <button
                              type="button"
                              onClick={() =>
                                setDeleteTarget({
                                  resource: "visit",
                                  id: v.id,
                                  name: v.summary ?? v.visitType,
                                })
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
                {(detail.visits ?? []).length === 0 && (
                  <EmptyRow colSpan={canEditVisit || canDeleteVisit ? 6 : 5} text="暂无走访记录" />
                )}
              </Table>
            </section>
          )}

          {activeTab === "financial" && (
            <div className="space-y-6">
              {detail.capabilities.budgets && (
                <section className="border-border rounded-md border p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <SectionTitle>预算（{detail.budgets?.length ?? 0}）</SectionTitle>
                    {canAddBudget && (
                      <button
                        type="button"
                        onClick={openBudgetCreate}
                        className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                      >
                        添加预算
                      </button>
                    )}
                  </div>
                  <Table
                    headers={[
                      "科目",
                      "金额",
                      "币种",
                      "备注",
                      ...(canEditBudget || canDeleteBudget ? ["操作"] : []),
                    ]}
                  >
                    {(detail.budgets ?? []).map((b) => (
                      <tr key={b.id}>
                        <td className="px-3 py-2 text-ink-primary">{b.category}</td>
                        <td className="px-3 py-2 text-ink-primary">{b.amount}</td>
                        <td className="px-3 py-2 text-ink-secondary">{b.currency}</td>
                        <td className="px-3 py-2 text-ink-secondary">{b.note ?? "—"}</td>
                        {(canEditBudget || canDeleteBudget) && (
                          <td className="px-3 py-2">
                            <div className="flex gap-2">
                              {canEditBudget && (
                                <button
                                  type="button"
                                  onClick={() => openBudgetEdit(b)}
                                  className="text-brand-600 text-sm hover:underline"
                                >
                                  编辑
                                </button>
                              )}
                              {canDeleteBudget && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDeleteTarget({
                                      resource: "budget",
                                      id: b.id,
                                      name: b.category,
                                    })
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
                    {(detail.budgets ?? []).length === 0 && (
                      <EmptyRow
                        colSpan={canEditBudget || canDeleteBudget ? 5 : 4}
                        text="暂无预算"
                      />
                    )}
                  </Table>
                </section>
              )}
              {detail.capabilities.expenses && (
                <section className="border-border rounded-md border p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <SectionTitle>费用（{detail.expenses?.length ?? 0}）</SectionTitle>
                    {canAddExpense && (
                      <button
                        type="button"
                        onClick={openExpenseCreate}
                        className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                      >
                        添加费用
                      </button>
                    )}
                  </div>
                  <Table
                    headers={[
                      "科目",
                      "金额",
                      "币种",
                      "发生时间",
                      "备注",
                      ...(canEditExpense || canDeleteExpense ? ["操作"] : []),
                    ]}
                  >
                    {(detail.expenses ?? []).map((e) => (
                      <tr key={e.id}>
                        <td className="px-3 py-2 text-ink-primary">{e.category}</td>
                        <td className="px-3 py-2 text-ink-primary">{e.amount}</td>
                        <td className="px-3 py-2 text-ink-secondary">{e.currency}</td>
                        <td className="px-3 py-2 text-ink-secondary">{formatDate(e.incurredAt)}</td>
                        <td className="px-3 py-2 text-ink-secondary">{e.note ?? "—"}</td>
                        {(canEditExpense || canDeleteExpense) && (
                          <td className="px-3 py-2">
                            <div className="flex gap-2">
                              {canEditExpense && (
                                <button
                                  type="button"
                                  onClick={() => openExpenseEdit(e)}
                                  className="text-brand-600 text-sm hover:underline"
                                >
                                  编辑
                                </button>
                              )}
                              {canDeleteExpense && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDeleteTarget({
                                      resource: "expense",
                                      id: e.id,
                                      name: e.category,
                                    })
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
                    {(detail.expenses ?? []).length === 0 && (
                      <EmptyRow
                        colSpan={canEditExpense || canDeleteExpense ? 6 : 5}
                        text="暂无费用"
                      />
                    )}
                  </Table>
                </section>
              )}
              {detail.capabilities.progresses && (
                <section className="border-border rounded-md border p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <SectionTitle>进度记录（{detail.progresses?.length ?? 0}）</SectionTitle>
                    {canAddProgress && (
                      <button
                        type="button"
                        onClick={openProgressCreate}
                        className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                      >
                        添加进度
                      </button>
                    )}
                  </div>
                  <Table
                    headers={[
                      "记录时间",
                      "进度",
                      "进展说明",
                      ...(canEditProgress || canDeleteProgress ? ["操作"] : []),
                    ]}
                  >
                    {(detail.progresses ?? []).map((p) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2 text-ink-secondary">{formatDate(p.recordedAt)}</td>
                        <td className="px-3 py-2 text-ink-primary">{p.progressPercent}%</td>
                        <td className="px-3 py-2 text-ink-secondary">{p.summary}</td>
                        {(canEditProgress || canDeleteProgress) && (
                          <td className="px-3 py-2">
                            <div className="flex gap-2">
                              {canEditProgress && (
                                <button
                                  type="button"
                                  onClick={() => openProgressEdit(p)}
                                  className="text-brand-600 text-sm hover:underline"
                                >
                                  编辑
                                </button>
                              )}
                              {canDeleteProgress && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDeleteTarget({
                                      resource: "progress",
                                      id: p.id,
                                      name: p.summary,
                                    })
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
                    {(detail.progresses ?? []).length === 0 && (
                      <EmptyRow
                        colSpan={canEditProgress || canDeleteProgress ? 4 : 3}
                        text="暂无进度记录"
                      />
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
              <div className="mb-3 flex items-center justify-between">
                <SectionTitle>标签（{detail.tags?.length ?? 0}）</SectionTitle>
                {canAddTag && (
                  <button
                    type="button"
                    onClick={openTagCreate}
                    className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    添加标签
                  </button>
                )}
              </div>
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
                        className="ml-1.5 text-xs text-red-600 hover:underline"
                      >
                        删除
                      </button>
                    )}
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
