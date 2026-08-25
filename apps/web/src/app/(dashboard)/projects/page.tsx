"use client";

/**
 * Projects — 项目管理列表页（UI-06 Opportunity + Project 现代重构）
 *
 * 依据 Contract Card（projects.md）：backend CRUD FINAL + transition/close/acceptance，
 * 本线开放 List/Detail 现代视觉。结构：AppPage + EntityListWorkspace（Header → Toolbar → Table → Pagination）。
 * 不改 backend / 状态机 / action；Create/Edit 表单见 F2-4A2；Tabs 见 F2-4B。
 * UI-06：阶段文案/语义色统一消费 lib/project-stage.ts；进度列右对齐 tabular-nums；行操作收进右侧浮现区。
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";
import {
  PROJECT_PRIORITY_LABELS,
  PROJECT_PRIORITY_OPTIONS,
  PROJECT_STAGE_LABELS,
  PROJECT_STAGE_OPTIONS,
  PROJECT_STAGE_TONES,
} from "@/lib/project-stage";

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

function ProjectList() {
  const { state } = useSession();
  const router = useRouter();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("project", "create"));
  const canEdit =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("project", "edit"));
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
        emptyMessage="暂无项目——点击「+ 新建项目」创建第一个项目"
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
              {PROJECT_STAGE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <select
              value={priorityInput}
              onChange={(e) => setPriorityInput(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">全部优先级</option>
              {PROJECT_PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
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
              <StatusBadge
                status={row.stage}
                label={PROJECT_STAGE_LABELS[row.stage] ?? row.stage}
                tone={PROJECT_STAGE_TONES[row.stage] ?? "neutral"}
              />
            ),
          },
          { key: "customer", header: "客户", render: (row) => row.customer?.name ?? "—" },
          {
            key: "priority",
            header: "优先级",
            render: (row) => (row.priority ? PROJECT_PRIORITY_LABELS[row.priority] ?? row.priority : "—"),
          },
          {
            key: "progressPercent",
            header: "进度",
            align: "right",
            render: (row) => (
              <span className="tabular-nums text-ink-primary">
                {row.progressPercent != null ? `${row.progressPercent}%` : "—"}
              </span>
            ),
          },
          {
            key: "openTasks",
            header: "进行中任务",
            align: "right",
            render: (row) => <span className="tabular-nums text-ink-primary">{String(row._count?.tasks ?? 0)}</span>,
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
        rowActions={(row) => (
          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={() => router.push("/projects/" + row.id)}
              className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-slate-100"
            >
              详情
            </button>
            {canEdit && row.stage !== "CLOSED" ? (
              <button
                type="button"
                onClick={() => router.push("/projects/" + row.id + "/edit")}
                className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-slate-100"
              >
                编辑
              </button>
            ) : null}
          </div>
        )}
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
