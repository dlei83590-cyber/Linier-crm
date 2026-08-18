"use client";

/** Users — 用户管理列表页（Pending Pages Completion Gate — Batch 2） */
import { useEffect, useState } from "react";
import Link from "next/link";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace } from "@/components/workspace";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";
import { apiFetch } from "@/lib/api-client";
import { roleLabel } from "@/lib/frontend/labels";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
  departmentId: string | null;
  department?: { id: string; code: string; name: string } | null;
  roles: Array<{ role: { id: string; code: string; name: string } }>;
  createdAt: string;
}

interface DepartmentOption {
  id: string;
  code: string;
  name: string;
}

function UserList() {
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("user", "create"));

  const [emailInput, setEmailInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [deptInput, setDeptInput] = useState("");
  const [activeInput, setActiveInput] = useState("");
  const [depts, setDepts] = useState<DepartmentOption[]>([]);
  const [filters, setFilters] = useState<{ email?: string; name?: string; departmentId?: string; isActive?: string }>({});

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<DepartmentOption[]>("/api/departments?pageSize=100", { signal: controller.signal })
      .then((body) => setDepts(body.data))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<UserRow>("/api/users", filters);

  const applyFilter = () => {
    const next: { email?: string; name?: string; departmentId?: string; isActive?: string } = {};
    if (emailInput.trim()) next.email = emailInput.trim();
    if (nameInput.trim()) next.name = nameInput.trim();
    if (deptInput) next.departmentId = deptInput;
    if (activeInput) next.isActive = activeInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setEmailInput("");
    setNameInput("");
    setDeptInput("");
    setActiveInput("");
    setFilters({});
    setPage(1);
  };

  return (
    <AppPage>
      <EntityListWorkspace<UserRow>
        title="用户管理"
        description="管理平台用户账号、启用状态与部门归属"
        headerActions={
          canCreate ? (
            <Link
              href="/users/new"
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              + 新建用户
            </Link>
          ) : undefined
        }
        filters={
          <>
            <input
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按邮箱搜索"
              className="w-48 rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            />
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按姓名搜索"
              className="w-32 rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            />
            <select
              value={deptInput}
              onChange={(e) => setDeptInput(e.target.value)}
              className="rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            >
              <option value="">全部部门</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
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
          {
            key: "email",
            header: "邮箱",
            render: (row) => (
              <Link href={`/users/${row.id}/edit`} className="font-medium text-brand-600 hover:underline">
                {row.email}
              </Link>
            ),
          },
          { key: "name", header: "姓名", render: (row) => row.name ?? "—" },
          { key: "department", header: "部门", render: (row) => row.department?.name ?? "—" },
          {
            key: "roles",
            header: "角色",
            render: (row) => row.roles.map((r) => roleLabel(r.role.code, r.role.name)).join("、") || "—",
          },
          { key: "isActive", header: "状态", render: (row) => (row.isActive ? "启用" : "停用") },
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
    <PermissionGuard permission={actionPermission("user", "view")}>
      <UserList />
    </PermissionGuard>
  );
}