"use client";

/**
 * Projects — 项目管理列表页（F2-4A CRM/Project Workspace，CTO #11974）
 *
 * 依据 Contract Card（projects.md）：backend CRUD FINAL + transition/close/acceptance，
 * 本 Wave 开放 List/Detail。结构：AppPage + EntityListWorkspace（Header → Toolbar → Table → Pagination）。
 * 不改 backend / 状态机 / action；Create/Edit 表单见 F2-4A2；Tabs 见 F2-4B。
 */
import { useState } from "react";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";

interface ProjectRow {
  id: string;
  code: string;
  name: string;
  stage: string;
  priority: string | null;
  progressPercent: string | null;
  createdAt: string;
  customer?: { id: string; code: string | null; name: string | null; type: string | null } | null;
  opportunity?: { id: string; code: string | null; name: string | null; stage: string | null } | null;
  closure?: { id: string; closedAt: string | null; reason: string | null } | null;
  _count?: { members: number; tasks: number; risks: number };
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

const PRIORITY_OPTIONS = ["HIGH", "MEDIUM", "LOW"] as const;

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

function ProjectList() {
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("project", "create"));
  const [codeInput, setCodeInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [stageInput, setStageInput] = useState("");
  const [priorityInput, setPriorityInput] = useState("");
  const [filters, setFilters] = useState<{
    code?: string;
    name?: string;
    stage?: string;
    priority?: string;
  }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<ProjectRow>("/api/projects", filters);

  const applyFilter = () => {
    const next: { code?: string; name?: string; stage?: string; priority?: string } = {};
    if (codeInput.trim()) next.code = codeInput.trim();
    if (nameInput.trim()) next.name = nameInput.trim();
    if (stageInput) next.stage = stageInput;
    if (priorityInput) next.priority = priorityInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setCodeInput("");
    setNameInput("");
    setStageInput("");
    setPriorityInput("");
    setFilters({});
    setPage(1);
  };

  return (
    <AppPage>
      <EntityListWorkspace<ProjectRow>
        title="项目管理"
        description="试样 / 测试 / 小批量 / 批量供货阶段项目"
        headerActions={
          canCreate ? (
            <Link
              href="/projects/new"
              className={BUTTON_PRIMARY_CLASS}
            >
              + 新建项目
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
              placeholder="按项目编号搜索"
              className={"w-40 " + SELECT_CLASS}
            />
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按项目名称搜索"
              className={"w-40 " + SELECT_CLASS}
            />
            <select
              value={stageInput}
              onChange={(e) => setStageInput(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">全部阶段</option>
              {STAGE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </select>
            <select
              value={priorityInput}
              onChange={(e) => setPriorityInput(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">全部优先级</option>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
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
              className={BUTTON_PRIMARY_CLASS}
            >
              查询
            </button>
            <button
              type="button"
              onClick={resetFilter}
              className={BUTTON_SECONDARY_CLASS}
            >
              重置
            </button>
          </>
        }
        columns={[
          {
            key: "code",
            header: "项目编号",
            render: (row) => (
              <Link
                href={`/projects/${row.id}`}
                className="font-medium text-brand-600 hover:underline"
              >
                {row.code}
              </Link>
            ),
          },
          { key: "name", header: "项目名称", render: (row) => row.name },
          {
            key: "stage",
            header: "阶段",
            render: (row) => (
              <StatusBadge status={row.stage} label={STAGE_LABELS[row.stage]} tone={STAGE_TONE_MAP[row.stage]} />
            ),
          },
          { key: "customer", header: "客户", render: (row) => row.customer?.name ?? "—" },
          {
            key: "priority",
            header: "优先级",
            render: (row) => (row.priority ? PRIORITY_LABELS[row.priority] ?? row.priority : "—"),
          },
          {
            key: "progressPercent",
            header: "进度",
            render: (row) => (row.progressPercent != null ? `${row.progressPercent}%` : "—"),
          },
          {
            key: "openTasks",
            header: "进行中任务",
            render: (row) => String(row._count?.tasks ?? 0),
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
    <PermissionGuard permission={actionPermission("project", "view")}>
      <ProjectList />
    </PermissionGuard>
  );
}