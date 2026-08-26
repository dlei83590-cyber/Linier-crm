"use client";

/** Roles — 角色权限列表页（Pending Pages Completion Gate — Batch 2） */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery, readUrlFilterParams } from "@/lib/use-list-query";
import { roleLabel } from "@/lib/frontend/labels";

interface RoleRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  _count?: { permissions: number; users: number };
}

function RoleList() {
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("role", "create"));

  const [codeInput, setCodeInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [filters, setFilters] = useState<{ code?: string; name?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, setPageSize, refresh } =
    useListQuery<RoleRow>("/api/roles", filters, 20, { syncUrl: true });

  // URL 筛选恢复（hydration 后一次性应用；刷新/分享后筛选不丢失）
  const urlRestored = useRef(false);
  useEffect(() => {
    if (urlRestored.current) return;
    urlRestored.current = true;
    const u = readUrlFilterParams(["code", "name"]);
    setCodeInput(u.code ?? "");
    setNameInput(u.name ?? "");
    setFilters(() => {
      const n: { code?: string; name?: string } = {};
      if (u.code) n.code = u.code;
      if (u.name) n.name = u.name;
      return n;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <EntityListWorkspace<RoleRow>
        title="角色权限"
        description="维护角色定义与权限映射关系"
        emptyMessage="暂无角色——点击「+ 新建角色」创建第一个角色"
        headerActions={
          canCreate ? (
            <Link
              href="/roles/new"
              className={BUTTON_PRIMARY_CLASS}
            >
              + 新建角色
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
              className={"w-40 " + SELECT_CLASS}
            />
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按名称搜索"
              className={"w-40 " + SELECT_CLASS}
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
              <Link href={`/roles/${row.id}/edit`} className="font-medium text-brand-600 hover:underline">
                {row.code}
              </Link>
            ),
          },
          { key: "name", header: "名称", render: (row) => roleLabel(row.code, row.name) },
          { key: "description", header: "描述", render: (row) => row.description ?? "—" },
          { key: "permissionCount", header: "权限数", render: (row) => row._count?.permissions ?? 0 },
          { key: "userCount", header: "用户数", render: (row) => row._count?.users ?? 0 },
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
          filters.code ? { key: "code", label: `编码：${filters.code}`, onClear: () => { setCodeInput(""); setFilters((prev) => { const n = { ...prev }; delete n.code; return n; }); } } : null,
          filters.name ? { key: "name", label: `名称：${filters.name}`, onClear: () => { setNameInput(""); setFilters((prev) => { const n = { ...prev }; delete n.name; return n; }); } } : null,
        ].filter((c): c is NonNullable<typeof c> => c !== null)}
      />
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("role", "view")}>
      <RoleList />
    </PermissionGuard>
  );
}