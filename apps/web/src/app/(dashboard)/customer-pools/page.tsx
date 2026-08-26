"use client";

/**
 * UI-05 — 客户公海池列表（现代重构）
 *
 * - 真实筛选接线：编码 / 名称 / 范围类型 / 启用状态（GET /api/customer-pools 原生支持）
 * - 状态用 StatusBadge（启用=success / 停用=neutral），范围用域 Accent 标签（customer-project）
 * - 三态统一由 EntityListWorkspace 提供（Skeleton / ErrorRow+Retry / EmptyState）
 * - 动作按钮只消费真实 API + 权限门（新建 = customer-pool:create）
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import {
  buildPoolListParams,
  poolListHasFilter,
  type PoolListFilterState,
} from "@/lib/customer-pool/filters";

interface PoolRow {
  id: string;
  code: string;
  name: string;
  scopeType: string;
  scopeValue: string | null;
  isActive: boolean;
  _count: { rules: number; entries: number };
}

const SCOPE_LABELS: Record<string, string> = { GLOBAL: "全局", REGION: "区域", DEPARTMENT: "部门" };

function CustomerPoolList() {
  const [codeInput, setCodeInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [scopeInput, setScopeInput] = useState<PoolListFilterState["scopeType"]>("");
  const [activeInput, setActiveInput] = useState<PoolListFilterState["isActive"]>("");
  const [filters, setFilters] = useState<PoolListFilterState>({});

  // 筛选状态 → 查询参数（useMemo 保持引用稳定，避免 useListQuery 每渲染重查）
  const queryParams = useMemo(() => buildPoolListParams(filters), [filters]);

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<PoolRow>("/api/customer-pools", queryParams);

  const applyFilter = () => {
    setFilters({ code: codeInput, name: nameInput, scopeType: scopeInput, isActive: activeInput });
    setPage(1);
  };

  const resetFilter = () => {
    setCodeInput("");
    setNameInput("");
    setScopeInput("");
    setActiveInput("");
    setFilters({});
    setPage(1);
  };

  return (
    <AppPage>
      <EntityListWorkspace<PoolRow>
        title="客户公海"
        description="多公海池定义：GLOBAL / REGION（区域字符串）/ DEPARTMENT（部门）"
        emptyMessage={
          poolListHasFilter(filters)
            ? "没有符合条件的公海池——调整筛选条件后重试"
            : "暂无公海池——点击「+ 新建公海池」创建第一个池"
        }
        headerActions={
          <PermissionGuard permission={actionPermission("customer-pool", "create")}>
            <Link href="/customer-pools/new" className={BUTTON_PRIMARY_CLASS}>
              + 新建公海池
            </Link>
          </PermissionGuard>
        }
        filters={
          <>
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按编码搜索"
              className={"w-36 " + SELECT_CLASS}
              aria-label="按编码搜索"
            />
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按名称搜索"
              className={"w-40 " + SELECT_CLASS}
              aria-label="按名称搜索"
            />
            <select
              value={scopeInput}
              onChange={(e) => setScopeInput(e.target.value as PoolListFilterState["scopeType"])}
              className={SELECT_CLASS}
              aria-label="按范围类型筛选"
            >
              <option value="">全部范围</option>
              <option value="GLOBAL">全局</option>
              <option value="REGION">区域</option>
              <option value="DEPARTMENT">部门</option>
            </select>
            <select
              value={activeInput}
              onChange={(e) => setActiveInput(e.target.value as PoolListFilterState["isActive"])}
              className={SELECT_CLASS}
              aria-label="按启用状态筛选"
            >
              <option value="">全部状态</option>
              <option value="true">启用</option>
              <option value="false">停用</option>
            </select>
          </>
        }
        toolbarActions={
          <>
            {/* 每页最多 1 个视觉 Primary：新建公海池为 Primary，查询/重置为 secondary */}
            <button type="button" onClick={applyFilter} className={BUTTON_SECONDARY_CLASS}>
              查询
            </button>
            <button type="button" onClick={resetFilter} className={BUTTON_SECONDARY_CLASS}>
              重置
            </button>
          </>
        }
        columns={[
          {
            key: "code",
            header: "编码",
            render: (row) => (
              <Link href={"/customer-pools/" + row.id} className="font-medium text-brand-600 hover:underline">
                {row.code}
              </Link>
            ),
          },
          { key: "name", header: "名称", render: (row) => <span className="font-medium text-ink-primary">{row.name}</span> },
          {
            key: "scopeType",
            header: "范围",
            render: (row) => (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-domain-customer-project-50 px-2.5 py-0.5 text-xs font-medium text-domain-customer-project-700">
                <span className="h-1.5 w-1.5 rounded-full bg-domain-customer-project-500" aria-hidden="true" />
                {SCOPE_LABELS[row.scopeType] ?? row.scopeType}
              </span>
            ),
          },
          { key: "scopeValue", header: "范围值", render: (row) => row.scopeValue ?? "—" },
          {
            key: "isActive",
            header: "状态",
            render: (row) => (
              <StatusBadge
                status={row.isActive ? "ACTIVE" : "INACTIVE"}
                label={row.isActive ? "启用" : "停用"}
                tone={row.isActive ? "success" : "neutral"}
              />
            ),
          },
          {
            key: "counts",
            header: "规则 / 条目",
            render: (row) => (
              <span className="tabular-nums text-ink-secondary">
                {String(row._count?.rules ?? 0)}
                <span className="text-ink-muted"> / </span>
                {String(row._count?.entries ?? 0)}
              </span>
            ),
          },
        ]}
        rows={items}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        onRetry={refresh}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        rowActions={(r: PoolRow) => (
          <div className="flex justify-end gap-1">
            <Link
              href={"/customer-pools/" + r.id}
              className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-surface-hover"
            >
              查看
            </Link>
          </div>
        )}
      />
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("customer-pool", "view")}>
      <CustomerPoolList />
    </PermissionGuard>
  );
}
