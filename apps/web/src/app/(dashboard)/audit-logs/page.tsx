"use client";

/**
 * Audit Logs — 操作日志列表页（F2-6B 批 3）
 *
 * 只读 List：AppPage → EntityListWorkspace → useListQuery。
 * 消费 FINAL 契约 GET /api/audit-logs（分页 + entityType/action/result 过滤）。
 * PermissionGuard 对齐 API requirePermission("audit:view")。
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { actionPermission } from "@nilier-crm/shared";
import type { StatusTone } from "@/components/design-system";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery, readUrlFilterParams } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";

interface AuditLogRow {
  id: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  result: string;
  requestId?: string | null;
  createdAt: string;
  actor?: { id: string; email: string; name: string | null } | null;
}

const RESULT_TONE: Record<string, StatusTone> = {
  SUCCESS: "success",
  FAILURE: "danger",
  PARTIAL: "warning",
};

/** 操作结果中文业务名（Business UX Rationalization：枚举展示中文，不展示数据库枚举值；key 保留真实 enum） */
const RESULT_LABELS: Record<string, string> = {
  SUCCESS: "成功",
  FAILURE: "失败",
  PARTIAL: "部分成功",
};

const RESULT_OPTIONS = ["SUCCESS", "FAILURE", "PARTIAL"] as const;

function AuditLogList() {
  const [entityTypeInput, setEntityTypeInput] = useState("");
  const [actionInput, setActionInput] = useState("");
  const [resultInput, setResultInput] = useState("");
  const [filters, setFilters] = useState<{ entityType?: string; action?: string; result?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, setPageSize, refresh } =
    useListQuery<AuditLogRow>("/api/audit-logs", filters, 20, { syncUrl: true });

  // URL 筛选恢复（hydration 后一次性应用；刷新/分享后筛选不丢失）
  const urlRestored = useRef(false);
  useEffect(() => {
    if (urlRestored.current) return;
    urlRestored.current = true;
    const u = readUrlFilterParams(["entityType", "action", "result"]);
    setEntityTypeInput(u.entityType ?? "");
    setActionInput(u.action ?? "");
    setResultInput(u.result ?? "");
    setFilters(() => {
      const n: { entityType?: string; action?: string; result?: string } = {};
      if (u.entityType) n.entityType = u.entityType;
      if (u.action) n.action = u.action;
      if (u.result) n.result = u.result;
      return n;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilter = () => {
    const next: { entityType?: string; action?: string; result?: string } = {};
    if (entityTypeInput.trim()) next.entityType = entityTypeInput.trim();
    if (actionInput.trim()) next.action = actionInput.trim();
    if (resultInput) next.result = resultInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setEntityTypeInput("");
    setActionInput("");
    setResultInput("");
    setFilters({});
    setPage(1);
  };

  return (
    <AppPage>
      <EntityListWorkspace<AuditLogRow>
        title="操作日志"
        description="审计记录（安全敏感与破坏性操作）"
        filters={
          <>
            <input
              value={entityTypeInput}
              onChange={(e) => setEntityTypeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="实体类型"
              className={"w-36 " + SELECT_CLASS}
            />
            <input
              value={actionInput}
              onChange={(e) => setActionInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="操作"
              className={"w-36 " + SELECT_CLASS}
            />
            <select
              value={resultInput}
              onChange={(e) => setResultInput(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">全部结果</option>
              {RESULT_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
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
            key: "action",
            header: "操作",
            render: (row) => (
              <Link
                href={`/audit-logs/${row.id}`}
                className="font-medium text-brand-600 hover:underline"
              >
                {row.action}
              </Link>
            ),
          },
          {
            key: "entityType",
            header: "实体类型",
            render: (row) => row.entityType ?? "—",
          },
          {
            key: "entityId",
            header: "实体 ID",
            render: (row) => (row.entityId ? String(row.entityId).slice(0, 12) : "—"),
          },
          {
            key: "result",
            header: "结果",
            render: (row) => (
              <StatusBadge status={row.result} label={RESULT_LABELS[row.result] ?? row.result} toneMap={RESULT_TONE} />
            ),
          },
          {
            key: "actor",
            header: "操作人",
            render: (row) => row.actor?.name ?? row.actor?.email ?? "—",
          },
          {
            key: "createdAt",
            header: "时间",
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
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        activeFilters={[
          filters.entityType ? { key: "entityType", label: `实体类型：${filters.entityType}`, onClear: () => { setEntityTypeInput(""); setFilters((prev) => { const n = { ...prev }; delete n.entityType; return n; }); } } : null,
          filters.action ? { key: "action", label: `操作：${filters.action}`, onClear: () => { setActionInput(""); setFilters((prev) => { const n = { ...prev }; delete n.action; return n; }); } } : null,
          filters.result ? { key: "result", label: `结果：${RESULT_LABELS[filters.result] ?? filters.result}`, onClear: () => { setResultInput(""); setFilters((prev) => { const n = { ...prev }; delete n.result; return n; }); } } : null,
        ].filter((c): c is NonNullable<typeof c> => c !== null)}
      />
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("audit", "view")}>
      <AuditLogList />
    </PermissionGuard>
  );
}