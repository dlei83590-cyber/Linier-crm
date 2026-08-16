"use client";

/**
 * Unit of Measures — 计量单位列表页（F2-2 Master Data Workspaces）
 *
 * 依据 Contract Card（unit-of-measures.md）：backend 仅 GET list FINAL →
 * 本 Wave 只实现 List（无 Detail/Create/Edit contract，不越界补后端）。
 */
import { useState } from "react";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";

interface UomRow {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  isActive: boolean;
  approvalStatus: string | null;
  createdAt: string;
}

const APPROVAL_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "已提交",
  APPROVED: "已批准",
  REJECTED: "已拒绝",
};

const APPROVAL_TONE_MAP: Record<string, "neutral" | "info" | "success" | "danger"> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  APPROVED: "success",
  REJECTED: "danger",
};

function UomList() {
  const [codeInput, setCodeInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [activeInput, setActiveInput] = useState("");
  const [filters, setFilters] = useState<{ code?: string; name?: string; isActive?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<UomRow>("/api/unit-of-measures", filters);

  const applyFilter = () => {
    const next: { code?: string; name?: string; isActive?: string } = {};
    if (codeInput.trim()) next.code = codeInput.trim();
    if (nameInput.trim()) next.name = nameInput.trim();
    if (activeInput) next.isActive = activeInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setCodeInput("");
    setNameInput("");
    setActiveInput("");
    setFilters({});
    setPage(1);
  };

  return (
    <AppPage>
      <EntityListWorkspace<UomRow>
        title="计量单位"
        description="计量单位主数据（只读：后端当前仅开放列表契约）"
        filters={
          <>
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按编码搜索"
              className="w-40 rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            />
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按名称搜索"
              className="w-40 rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            />
            <select
              value={activeInput}
              onChange={(e) => setActiveInput(e.target.value)}
              className="rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            >
              <option value="">全部状态</option>
              <option value="true">启用</option>
              <option value="false">停用</option>
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
          { key: "code", header: "编码" },
          { key: "name", header: "名称" },
          { key: "symbol", header: "符号", render: (row) => row.symbol ?? "—" },
          {
            key: "approvalStatus",
            header: "审批状态",
            render: (row) =>
              row.approvalStatus ? (
                <StatusBadge
                  status={row.approvalStatus}
                  label={APPROVAL_LABELS[row.approvalStatus] ?? row.approvalStatus}
                  toneMap={APPROVAL_TONE_MAP}
                />
              ) : (
                "—"
              ),
          },
          {
            key: "isActive",
            header: "启用",
            render: (row) => (row.isActive ? "是" : "否"),
          },
          {
            key: "createdAt",
            header: "创建时间",
            render: (row) => formatDate(row.createdAt),
          },
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
    <PermissionGuard permission={actionPermission("unit-of-measure", "view")}>
      <UomList />
    </PermissionGuard>
  );
}
