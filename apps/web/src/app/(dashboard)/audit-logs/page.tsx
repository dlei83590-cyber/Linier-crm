"use client";

/**
 * Audit Logs — 操作日志列表页（F2-6B 批 3）
 *
 * 只读 List：AppPage → EntityListWorkspace → useListQuery。
 * 消费 FINAL 契约 GET /api/audit-logs（分页 + entityType/action/result 过滤）。
 * PermissionGuard 对齐 API requirePermission("audit:view")。
 */
import { useState } from "react";
import Link from "next/link";
import { actionPermission } from "@nilier-crm/shared";
import type { StatusTone } from "@/components/design-system";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
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

const RESULT_OPTIONS = ["SUCCESS", "FAILURE", "PARTIAL"] as const;

function AuditLogList() {
  const [entityTypeInput, setEntityTypeInput] = useState("");
  const [actionInput, setActionInput] = useState("");
  const [resultInput, setResultInput] = useState("");
  const [filters, setFilters] = useState<{ entityType?: string; action?: string; result?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<AuditLogRow>("/api/audit-logs", filters);

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
            render: (row) => <StatusBadge status={row.result} toneMap={RESULT_TONE} />,
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