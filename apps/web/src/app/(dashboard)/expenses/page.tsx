"use client";

/**
 * Expenses — 报销申请列表页（feat(crm) 报销申请 MVP）
 *
 * 报销申请 = ProjectExpense 事实（复用现有模型，禁止平行新模型）。
 * 客户归属直接走 Project → BusinessPartner（customerId），不新造归属字段。
 * 列表消费只读 GET /api/expenses（跨项目聚合 + 按客户/项目/科目筛选）；
 * 创建走既有 POST /api/projects/:id/expenses（单一写入源，B2-1B 已交付）。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { apiFetch } from "@/lib/api-client";
import { formatDateOnly, formatMoneyValue } from "@/lib/format";

interface ExpenseRow {
  id: string;
  projectId: string;
  category: string;
  expenseType: string | null;
  expenseAttribution: string | null;
  amount: string;
  currency: string;
  incurredAt: string | null;
  note: string | null;
  approvalStatus: string;
  createdAt: string;
  createdBy?: { id: string; name: string | null; email: string } | null;
  approvedBy?: { id: string; name: string | null; email: string } | null;
  project?: {
    id: string;
    code: string | null;
    name: string | null;
    stage: string | null;
    customer?: { id: string; code: string | null; name: string | null; type: string | null } | null;
  } | null;
}

interface PartnerOption {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface ProjectOption {
  id: string;
  code: string;
  name: string;
}

const CUSTOMER_TYPE_LABELS: Record<string, string> = {
  CUSTOMER: "客户",
  SUPPLIER: "供应商",
  BOTH: "客户兼供应商",
};

// 报销审批状态（Migration 0051：复用 ProjectExpense.approvalStatus 枚举）
const APPROVAL_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  PENDING: "待审批",
  APPROVED: "已批准",
  REJECTED: "已驳回",
};
// 语义色 tone 映射（FE2.0 UI-10：StatusBadge 统一，禁止页面自造状态色）
const APPROVAL_TONE: Record<string, "neutral" | "info" | "success" | "danger"> = {
  DRAFT: "neutral",
  PENDING: "info",
  APPROVED: "success",
  REJECTED: "danger",
};

function ExpensesList() {
  const router = useRouter();
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];
  const canCreate = hasPermission(roles, actionPermission("project-expense", "create"));

  // 筛选依赖数据：客户下拉 + 客户 → 项目级联
  const [customers, setCustomers] = useState<PartnerOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  const [customerInput, setCustomerInput] = useState("");
  const [projectInput, setProjectInput] = useState("");
  const [categoryInput, setCategoryInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ customerId?: string; projectId?: string; category?: string; status?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<ExpenseRow>("/api/expenses", filters);

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
        // 客户选项加载失败不阻断列表；用户可清空筛选查看全部
      });
    return () => controller.abort();
  }, []);

  // 客户 → 项目级联（复用 /api/projects?customerId= 过滤）
  useEffect(() => {
    if (!customerInput) {
      setProjects([]);
      setProjectInput("");
      return;
    }
    const controller = new AbortController();
    setProjectsLoading(true);
    apiFetch<{ items?: ProjectOption[] } | ProjectOption[]>(
      "/api/projects?customerId=" + encodeURIComponent(customerInput) + "&pageSize=100",
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
  }, [customerInput]);

  const handleCustomerChange = (value: string) => {
    setCustomerInput(value);
    setProjectInput(""); // 上级变化清空下级
  };

  const applyFilter = () => {
    const next: { customerId?: string; projectId?: string; category?: string; status?: string } = {};
    if (customerInput) next.customerId = customerInput;
    if (projectInput) next.projectId = projectInput;
    if (categoryInput.trim()) next.category = categoryInput.trim();
    if (statusInput) next.status = statusInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setCustomerInput("");
    setProjectInput("");
    setCategoryInput("");
    setStatusInput("");
    setFilters({});
    setPage(1);
  };

  return (
    <AppPage>
      <EntityListWorkspace<ExpenseRow>
        title="报销申请"
        description="项目费用报销申请（客户 → 项目归属），列表为真实 ProjectExpense 数据"
        emptyMessage="暂无报销申请——点击「+ 新建报销申请」创建第一条记录"
        headerActions={
          canCreate ? (
            <Link href="/expenses/new" className={BUTTON_PRIMARY_CLASS}>
              + 新建报销申请
            </Link>
          ) : undefined
        }
        filters={
          <>
            <select value={customerInput} onChange={(e) => handleCustomerChange(e.target.value)} className={"w-48 " + SELECT_CLASS}>
              <option value="">全部客户</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}（{c.code}）
                </option>
              ))}
            </select>
            <select
              value={projectInput}
              onChange={(e) => setProjectInput(e.target.value)}
              disabled={!customerInput}
              className={"w-48 " + SELECT_CLASS}
            >
              <option value="">{!customerInput ? "请先选择客户" : projectsLoading ? "加载中…" : "全部项目"}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{p.code}）
                </option>
              ))}
            </select>
            <input
              value={categoryInput}
              onChange={(e) => setCategoryInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按费用科目搜索"
              className={"w-40 " + SELECT_CLASS}
            />
            <select value={statusInput} onChange={(e) => setStatusInput(e.target.value)} className={"w-32 " + SELECT_CLASS}>
              <option value="">全部状态</option>
              <option value="DRAFT">草稿</option>
              <option value="PENDING">待审批</option>
              <option value="APPROVED">已批准</option>
              <option value="REJECTED">已驳回</option>
            </select>
          </>
        }
        toolbarActions={
          <>
            <button type="button" onClick={applyFilter} className={BUTTON_PRIMARY_CLASS}>
              查询
            </button>
            <button type="button" onClick={resetFilter} className={BUTTON_SECONDARY_CLASS}>
              重置
            </button>
          </>
        }
        columns={[
          {
            key: "customer",
            header: "客户",
            render: (row) => {
              const c = row.project?.customer;
              if (!c) return "—";
              const typeLabel = c.type ? CUSTOMER_TYPE_LABELS[c.type] ?? c.type : "";
              return (
                <span>
                  {c.name ?? "—"}
                  {typeLabel ? <span className="text-ink-muted ml-1 text-xs">（{typeLabel}）</span> : null}
                </span>
              );
            },
          },
          {
            key: "project",
            header: "项目",
            render: (row) => (
              <Link href={"/projects/" + row.projectId} className="text-brand-600 hover:underline">
                {row.project ? row.project.name ?? row.project.code ?? row.projectId : row.projectId}
              </Link>
            ),
          },
          {
            key: "expenseType",
            header: "费用类型",
            render: (row) => row.expenseType ?? "—",
          },
          { key: "category", header: "费用科目" },
          { key: "amount", header: "金额", align: "right", render: (row) => formatMoneyValue(row.amount) },
          { key: "incurredAt", header: "发生日期", render: (row) => formatDateOnly(row.incurredAt) },
          {
            key: "approvalStatus",
            header: "状态",
            render: (row) => (
              <StatusBadge
                status={row.approvalStatus}
                label={APPROVAL_LABELS[row.approvalStatus] ?? row.approvalStatus}
                toneMap={APPROVAL_TONE}
              />
            ),
          },
          {
            key: "applicant",
            header: "申请人",
            render: (row) => row.createdBy?.name ?? row.createdBy?.email ?? "—",
          },
          { key: "note", header: "备注", render: (row) => row.note ?? "—" },
          { key: "createdAt", header: "创建时间", render: (row) => formatDateOnly(row.createdAt) },
        ]}
        rows={items}
        rowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={refresh}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        rowActions={(row) => (
          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={() => router.push("/expenses/" + row.id)}
              className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-slate-100"
            >
              详情
            </button>
          </div>
        )}
      />
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("project-expense", "view")}>
      <ExpensesList />
    </PermissionGuard>
  );
}
