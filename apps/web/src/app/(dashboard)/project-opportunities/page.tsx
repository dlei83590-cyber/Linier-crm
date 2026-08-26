"use client";

/**
 * Project Opportunities — 项目机会列表页（UI-06 Opportunity + Project 现代重构）
 *
 * 依据 Contract Card（project-opportunities.md）：backend CRUD FINAL + convert，
 * 本线开放 List/Detail 现代视觉。结构：AppPage + EntityListWorkspace（Header → Toolbar → Table → Pagination）。
 * 不改 backend / 状态机 / action；Create/Edit 表单见 F2-4A2（customer selector 数据源 /api/business-partners?type=CUSTOMER，P0-1 SSOT）。
 * UI-06：阶段文案/语义色统一消费 lib/project-stage.ts；金额列右对齐 tabular-nums；行操作收进右侧浮现区。
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
import { formatDate, formatMoneyValue } from "@/lib/format";
import {
  PROJECT_STAGE_LABELS,
  PROJECT_STAGE_OPTIONS,
  PROJECT_STAGE_TONES,
} from "@/lib/project-stage";

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
  /** 商机跟进 MVP：该商机关联客户最近一次 FOLLOW_UP（服务端计算，零客户端推导） */
  lastFollowUpAt: string | null;
  daysSinceFollowUp: number | null;
  needsFollowUp: boolean;
  followUpThresholdDays: number;
}

function OpportunityList() {
  const { state } = useSession();
  const router = useRouter();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("project-opportunity", "create"));
  const canEdit =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("project-opportunity", "edit"));
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
        emptyMessage="暂无商机——点击「+ 新建商机」创建第一个商机"
        headerActions={
          canCreate ? (
            <Link
              href="/project-opportunities/new"
              className={BUTTON_PRIMARY_CLASS}
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
              className={"w-40 " + SELECT_CLASS}
            />
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按机会名称搜索"
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
              <StatusBadge
                status={row.stage}
                label={PROJECT_STAGE_LABELS[row.stage] ?? row.stage}
                tone={PROJECT_STAGE_TONES[row.stage] ?? "neutral"}
              />
            ),
          },
          { key: "customer", header: "客户", render: (row) => row.customer?.name ?? "—" },
          {
            key: "lastFollowUpAt",
            header: "最近跟进",
            render: (row) =>
              row.lastFollowUpAt ? (
                <div>
                  <div className="text-ink-primary">{formatDate(row.lastFollowUpAt)}</div>
                  <div className="text-xs text-ink-muted">
                    {row.daysSinceFollowUp != null ? "距今 " + row.daysSinceFollowUp + " 天" : ""}
                  </div>
                </div>
              ) : (
                <span className="text-ink-muted">从未跟进</span>
              ),
          },
          {
            key: "needsFollowUp",
            header: "跟进状态",
            render: (row) =>
              row.needsFollowUp ? (
                <StatusBadge status="FOLLOWUP_DUE" label="待跟进" tone="warning" />
              ) : (
                <span className="text-ink-muted">—</span>
              ),
          },
          {
            key: "project",
            header: "已转项目",
            render: (row) =>
              row.project ? (
                <Link
                  href={"/projects/" + row.project.id}
                  className="text-brand-600 hover:underline"
                >
                  {row.project.code ?? row.project.name ?? "—"}
                </Link>
              ) : (
                "—"
              ),
          },
          {
            key: "expectedRevenue",
            header: "预计营收",
            align: "right",
            render: (row) => (
              <span className="tabular-nums text-ink-primary">
                {formatMoneyValue(row.expectedRevenue)}
              </span>
            ),
          },
          {
            key: "successProbability",
            header: "成功率",
            align: "right",
            render: (row) => (
              <span className="tabular-nums text-ink-primary">
                {row.successProbability != null ? `${row.successProbability}%` : "—"}
              </span>
            ),
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
              onClick={() => router.push("/project-opportunities/" + row.id)}
              className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-surface-hover"
            >
              详情
            </button>
            {canEdit ? (
              <button
                type="button"
                onClick={() => router.push("/project-opportunities/" + row.id + "/edit")}
                className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-surface-hover"
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
    <PermissionGuard permission={actionPermission("project-opportunity", "view")}>
      <OpportunityList />
    </PermissionGuard>
  );
}
