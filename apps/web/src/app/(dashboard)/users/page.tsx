"use client";

/** Users — 用户管理列表页（Pending Pages Completion Gate — Batch 2） */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { actionPermission } from "@nilier-crm/shared";
import { can, useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace } from "@/components/workspace";
import { useListQuery, readUrlFilterParams } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { BUTTON_LINK_CLASS, BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { roleLabel } from "@/lib/frontend/labels";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { DEFAULT_INITIAL_PASSWORD } from "@nilier-crm/shared";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
  departmentId: string | null;
  department?: { id: string; code: string; name: string } | null;
  roles: Array<{ role: { id: string; code: string; name: string } }>;
  /** ADR-0058：附加授权计数（角色权限之外的额外勾选） */
  _count?: { permissions: number };
  /** ADR-0059：仍为初始密码（新建 / 已重置，登录后必须修改） */
  mustChangePassword: boolean;
  passwordChangedAt: string | null;
  createdAt: string;
}

interface DepartmentOption {
  id: string;
  code: string;
  name: string;
}

function UserList() {
  const { state } = useSession();
  const toast = useToast();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    can(state.user, actionPermission("user", "create"));
  // ADR-0059：重置密码复用 user:edit（ADMIN / SUPER_ADMIN；MANAGER 及以下无该权限）
  const canResetPassword =
    state.status === "authenticated" &&
    state.user !== null &&
    can(state.user, actionPermission("user", "edit"));

  // 重置密码确认（管理员唯一可用的密码操作）
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [resetting, setResetting] = useState(false);

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

  const { items, total, page, pageSize, loading, error, setPage, setPageSize, refresh } =
    useListQuery<UserRow>("/api/users", filters, 20, { syncUrl: true });

  // ADR-0059：管理员重置密码（回到初始密码 123456 + 用户下次登录强制改密）
  const handleResetPassword = () => {
    if (!resetTarget || resetting) return;
    setResetting(true);
    apiFetch(`/api/users/${resetTarget.id}/reset-password`, { method: "POST" })
      .then(() => {
        toast.warning(
          "密码已重置",
          `${resetTarget.email} 的密码已重置为初始密码 ${DEFAULT_INITIAL_PASSWORD}，该用户下次登录必须修改`,
        );
        setResetTarget(null);
        setResetting(false);
        refresh();
      })
      .catch((err: unknown) => {
        setResetTarget(null);
        setResetting(false);
        toast.error("重置失败", err instanceof ApiClientError ? err.message : "网络错误");
      });
  };

  // URL 筛选恢复（hydration 后一次性应用；刷新/分享后筛选不丢失）
  const urlRestored = useRef(false);
  useEffect(() => {
    if (urlRestored.current) return;
    urlRestored.current = true;
    const u = readUrlFilterParams(["email", "name", "departmentId", "isActive"]);
    setEmailInput(u.email ?? "");
    setNameInput(u.name ?? "");
    setDeptInput(u.departmentId ?? "");
    setActiveInput(u.isActive ?? "");
    setFilters(() => {
      const n: { email?: string; name?: string; departmentId?: string; isActive?: string } = {};
      if (u.email) n.email = u.email;
      if (u.name) n.name = u.name;
      if (u.departmentId) n.departmentId = u.departmentId;
      if (u.isActive) n.isActive = u.isActive;
      return n;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        emptyMessage="暂无用户——点击「+ 新建用户」创建第一个账号"
        headerActions={
          canCreate ? (
            <Link
              href="/users/new"
              className={BUTTON_PRIMARY_CLASS}
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
              className={"w-48 " + SELECT_CLASS}
            />
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按姓名搜索"
              className={"w-32 " + SELECT_CLASS}
            />
            <select
              value={deptInput}
              onChange={(e) => setDeptInput(e.target.value)}
              className={SELECT_CLASS}
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
              className={SELECT_CLASS}
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
          {
            key: "extraPermissions",
            header: "附加权限",
            render: (row) => (
              <Link href={`/users/${row.id}/edit`} className="text-brand-600 hover:underline">
                {row._count?.permissions ?? 0} 项
              </Link>
            ),
          },
          {
            key: "mustChangePassword",
            header: "密码",
            render: (row) =>
              row.mustChangePassword ? (
                <span className="text-status-warning-text">待修改初始密码</span>
              ) : (
                <span className="text-ink-secondary">用户已设置</span>
              ),
          },
          { key: "isActive", header: "状态", render: (row) => (row.isActive ? "启用" : "停用") },
          { key: "createdAt", header: "创建时间", render: (row) => formatDate(row.createdAt) },
        ]}
        rowActions={
          canResetPassword
            ? (row) => (
                <button
                  type="button"
                  onClick={() => setResetTarget(row)}
                  disabled={!row.isActive}
                  title={row.isActive ? "重置为初始密码（用户下次登录必须修改）" : "用户已停用，请先启用后再重置密码"}
                  className={BUTTON_LINK_CLASS + " disabled:cursor-not-allowed disabled:opacity-50"}
                >
                  重置密码
                </button>
              )
            : undefined
        }
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
          filters.email ? { key: "email", label: `邮箱：${filters.email}`, onClear: () => { setEmailInput(""); setFilters((prev) => { const n = { ...prev }; delete n.email; return n; }); } } : null,
          filters.name ? { key: "name", label: `姓名：${filters.name}`, onClear: () => { setNameInput(""); setFilters((prev) => { const n = { ...prev }; delete n.name; return n; }); } } : null,
          filters.departmentId ? { key: "departmentId", label: `部门：${depts.find((d) => d.id === filters.departmentId)?.name ?? filters.departmentId}`, onClear: () => { setDeptInput(""); setFilters((prev) => { const n = { ...prev }; delete n.departmentId; return n; }); } } : null,
          filters.isActive ? { key: "isActive", label: `状态：${filters.isActive === "true" ? "启用" : "停用"}`, onClear: () => { setActiveInput(""); setFilters((prev) => { const n = { ...prev }; delete n.isActive; return n; }); } } : null,
        ].filter((c): c is NonNullable<typeof c> => c !== null)}
      />
      <ConfirmDialog
        open={resetTarget !== null}
        title="重置密码"
        description={
          resetTarget
            ? `将 ${resetTarget.email} 的密码重置为初始密码 ${DEFAULT_INITIAL_PASSWORD}，该用户下次登录必须立即修改密码。是否继续？`
            : undefined
        }
        confirmLabel="重置密码"
        tone="danger"
        busy={resetting}
        onConfirm={handleResetPassword}
        onCancel={() => setResetTarget(null)}
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