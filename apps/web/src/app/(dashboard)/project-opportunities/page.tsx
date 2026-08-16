"use client";

/**
 * Project Opportunities — 项目机会列表页（F2-4A CRM/Project Workspace，CTO #11974）
 *
 * 依据 Contract Card（project-opportunities.md）：backend CRUD FINAL + convert，
 * 本 Wave 开放 List/Detail。结构：AppPage + EntityListWorkspace（Header → Toolbar → Table → Pagination）。
 * 不改 backend / 状态机 / action；Create/Edit 表单见 F2-4A2（customer selector 数据源 /api/customers 已核验）。
 */
import { useState } from "react";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";

interface OpportunityRow {
  id: string;
  code: string;
  name: string;
  stage: string;
  expectedRevenue: string | null;
  successProbability: string | null;
  paymentStatus: string;
  createdAt: string;
  customer?: { id: string; code: string | null; name: string | null; type: string | null } | null;
  project?: { id: string; code: string | null; name: string | null; stage: string | null } | null;
}

const STAGE_OPTIONS = [
  "LEAD",
  "QUALIFIED",
  "SOLUTION",
  "QUOTATION",
  "SAMPLING",
  "TESTING",
  "SMALL_BATCH",
  "MASS_SUPPLY",
  "PAUSED",
  "FAILED",
  "CLOSED",
] as const;

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

function OpportunityList() {
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("project-opportunity", "create"));
  const [codeInput, setCodeInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [stageInput, setStageInput] = useState("");
  const [filters, setFilters] = useState<{ code?: string; name?: string; stage?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<OpportunityRow>("/api/project-opportunities", filters);

  const applyFilter = () => {
    const next: { code?: string; name?: string; stage?: string } = {};
    if (codeInput.trim()) next.code = codeInput.trim();
    if (nameInput.trim()) next.name = nameInput.trim();
    if (stageInput) next.stage = stageInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setCodeInput("");
    setNameInput("");
    setStageInput("");
    setFilters({});
    setPage(1);
  };

  return (
    <AppPage>
      <EntityListWorkspace<OpportunityRow>
        title="项目机会"
        description="线索 → 准入 → 方案 → 报价阶段商机管理"
        headerActions={
          canCreate ? (
            <Link
              href="/project-opportunities/new"
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              + 新建机会
            </Link>
          ) : undefined
        }
        filters={
          <>
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按机会编号搜索"
              className="w-40 rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            />
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按机会名称搜索"
              className="w-40 rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            />
            <select
              value={stageInput}
              onChange={(e) => setStageInput(e.target.value)}
              className="rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            >
              <option value="">全部阶段</option>
              {STAGE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </select>
          </>
        }
        toolbarActions={
          <>
            <button
              type="button"
              onClick={applyFilter}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              查询
            </button>
            <button
              type="button"
              onClick={resetFilter}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-slate-50"
            >
              重置
            </button>
          </>
        }
        columns={[
          {
            key: "code",
            header: "机会编号",
            render: (row) => (
              <Link
                href={`/project-opportunities/${row.id}`}
                className="font-medium text-brand-600 hover:underline"
              >
                {row.code}
              </Link>
            ),
          },
          { key: "name", header: "机会名称", render: (row) => row.name },
          {
            key: "stage",
            header: "阶段",
            render: (row) => (
              <StatusBadge status={row.stage} label={STAGE_LABELS[row.stage]} tone={STAGE_TONE_MAP[row.stage]} />
            ),
          },
          { key: "customer", header: "客户", render: (row) => row.customer?.name ?? "—" },
          {
            key: "project",
            header: "已转项目",
            render: (row) => (row.project ? row.project.code ?? row.project.name ?? "—" : "—"),
          },
          { key: "expectedRevenue", header: "预计营收", render: (row) => row.expectedRevenue ?? "—" },
          {
            key: "successProbability",
            header: "成功率",
            render: (row) => (row.successProbability != null ? `${row.successProbability}%` : "—"),
          },
          { key: "createdAt", header: "创建时间", render: (row) => formatDate(row.createdAt) },
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
      />
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("project-opportunity", "view")}>
      <OpportunityList />
    </PermissionGuard>
  );
}
