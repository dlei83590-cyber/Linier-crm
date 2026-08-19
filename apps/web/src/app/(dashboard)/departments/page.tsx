"use client";

/** Departments — 部门管理列表页（Pending Pages Completion Gate — Batch 2） */
import { useState } from "react";
import Link from "next/link";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";

interface DepartmentRow {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  parent?: { id: string; code: string; name: string } | null;
  _count?: { users: number; children: number };
  createdAt: string;
}

function DepartmentList() {
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("department", "create"));

  const [codeInput, setCodeInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [filters, setFilters] = useState<{ code?: string; name?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<DepartmentRow>("/api/departments", filters);

  const applyFilter = () => {
    const next: { code?: string; name?: string } = {};
    if (codeInput.trim()) next.code = codeInput.trim();
    if (nameInput.trim()) next.name = nameInput.trim();
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setCodeInput("");
    setNameInput("");
    setFilters({});
    setPage(1);
  };

  return (
    <AppPage>
      <EntityListWorkspace<DepartmentRow>
        title="部门管理"
        description="维护组织架构与部门层级关系"
        headerActions={
          canCreate ? (
            <Link
              href="/departments/new"
              className={BUTTON_PRIMARY_CLASS}
            >
              + 新建部门
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
            header: "编码",
            render: (row) => (
              <Link href={`/departments/${row.id}/edit`} className="font-medium text-brand-600 hover:underline">
                {row.code}
              </Link>
            ),
          },
          { key: "name", header: "名称" },
          { key: "parent", header: "上级部门", render: (row) => row.parent?.name ?? "—" },
          { key: "childCount", header: "子部门", render: (row) => row._count?.children ?? 0 },
          { key: "userCount", header: "成员", render: (row) => row._count?.users ?? 0 },
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
    <PermissionGuard permission={actionPermission("department", "view")}>
      <DepartmentList />
    </PermissionGuard>
  );
}