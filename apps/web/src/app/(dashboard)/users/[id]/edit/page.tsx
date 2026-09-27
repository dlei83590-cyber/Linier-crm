"use client";

/** Users — 编辑用户（Pending Pages Completion Gate — Batch 2；无 CAS；密码可选重置；角色全量替换） */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { PageLoading } from "@/components/ui/skeleton";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { BUTTON_SECONDARY_CLASS, INPUT_CLASS } from "@/lib/ui-classes";
import { roleLabel } from "@/lib/frontend/labels";
import { PermissionTree } from "@/components/system/permission-tree";
import { selectedCodeList, type PermissionCatalogItem } from "@/lib/frontend/permission-tree";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { DEFAULT_INITIAL_PASSWORD, PASSWORD_POLICY_DESCRIPTION } from "@nilier-crm/shared";
import { formatDate } from "@/lib/format";

interface DepartmentOption {
  id: string;
  code: string;
  name: string;
}

interface RoleOption {
  id: string;
  code: string;
  name: string;
}

interface UserDetail {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
  departmentId: string | null;
  roles: Array<{ role: { id: string; code: string; name: string } }>;
  /** ADR-0058：附加授权（全量 code） */
  permissions: Array<{ id: string; code: string; module: string; name: string }>;
  /** ADR-0059：是否仍为初始密码（管理员重置后 = true） */
  mustChangePassword: boolean;
  passwordChangedAt: string | null;
}

const inputClass = INPUT_CLASS;


function UserEditForm() {
  const router = useRouter();
  const toast = useToast();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [depts, setDepts] = useState<DepartmentOption[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  // ADR-0058：用户附加授权
  const [catalog, setCatalog] = useState<PermissionCatalogItem[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set<string>());
  const [unknownCodes, setUnknownCodes] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);
  // ADR-0059：密码状态（只读展示 + 管理员重置入口；管理员不得直接设定密码）
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [passwordChangedAt, setPasswordChangedAt] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      apiFetch<UserDetail>(`/api/users/${id}`),
      apiFetch<DepartmentOption[]>("/api/departments?pageSize=100"),
      apiFetch<RoleOption[]>("/api/roles?pageSize=100"),
      apiFetch<{ items: PermissionCatalogItem[]; total: number }>("/api/permissions"),
    ])
      .then(([userBody, deptBody, roleBody, permissionBody]) => {
        const d = userBody.data;
        const items = permissionBody.data.items;
        const catalogCodes = new Set(items.map((p) => p.code));
        const granted = d.permissions.map((p) => p.code);
        setEmail(d.email);
        setName(d.name ?? "");
        setDepartmentId(d.departmentId ?? "");
        setRoleIds(d.roles.map((r) => r.role.id));
        setIsActive(d.isActive);
        setMustChangePassword(d.mustChangePassword);
        setPasswordChangedAt(d.passwordChangedAt ?? null);
        setDepts(deptBody.data);
        setRoles(roleBody.data);
        setCatalog(items);
        // 目录外历史权限码保留（禁止静默丢弃）
        setSelected(new Set(granted));
        setUnknownCodes(granted.filter((c) => !catalogCodes.has(c)).sort());
        setDirty(false);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const toggleRole = (roleId: string) => {
    setRoleIds((prev) => (prev.includes(roleId) ? prev.filter((r) => r !== roleId) : [...prev, roleId]));
  };

  // ADR-0059：管理员唯一的密码操作 = 重置为初始密码（不接受自定义密码）
  const handleResetPassword = () => {
    if (resetting) return;
    setResetting(true);
    apiFetch<{ mustChangePassword: boolean }>(`/api/users/${id}/reset-password`, { method: "POST" })
      .then(() => {
        setResetOpen(false);
        setResetting(false);
        setMustChangePassword(true);
        setPasswordChangedAt(new Date().toISOString());
        toast.warning(
          "密码已重置",
          `已重置为初始密码 ${DEFAULT_INITIAL_PASSWORD}，该用户下次登录必须修改密码`,
        );
      })
      .catch((err: unknown) => {
        setResetOpen(false);
        setResetting(false);
        toast.error("重置失败", err instanceof ApiClientError ? err.message : "网络错误");
      });
  };

  const handleSave = () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const payload: Record<string, unknown> = {
      name: name.trim() || null,
      departmentId: departmentId || null,
      isActive,
      roleIds,
      permissionCodes: selectedCodeList(selected),
    };
    apiFetch<{ id: string }>(`/api/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    })
      .then(() => router.push("/users"))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  if (loading) {
    return (
      <EntityFormWorkspace title="编辑用户" backHref="/users" mode="edit" submitting={false} onSave={handleSave} onCancel={() => router.push("/users")}>
        <PageLoading rows={4} />
      </EntityFormWorkspace>
    );
  }

  if (loadError) {
    return (
      <EntityFormWorkspace title="编辑用户" backHref="/users" mode="edit" submitting={false} error={loadError} onSave={handleSave} onCancel={() => router.push("/users")}>
        <p className="px-4 py-6 text-sm text-ink-secondary">加载失败</p>
      </EntityFormWorkspace>
    );
  }

  return (
    <EntityFormWorkspace
      title="编辑用户"
      description={`邮箱：${email}`}
      backHref="/users"
      mode="edit"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSave}
      onCancel={() => router.push("/users")}
    >
      <section className="rounded-md border border-border p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="邮箱">
            <input value={email} readOnly className={`${inputClass} bg-canvas`} />
          </FormField>
          <FormField label="姓名">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </FormField>
          <FormField label="部门">
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={inputClass}>
              <option value="">未分配</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="启用">
            <select value={isActive ? "true" : "false"} onChange={(e) => setIsActive(e.target.value === "true")} className={inputClass}>
              <option value="true">是</option>
              <option value="false">否</option>
            </select>
          </FormField>
          <div className="md:col-span-2">
            <FormField label="角色">
              <div className="flex flex-wrap gap-2">
                {roles.map((r) => (
                  <label key={r.id} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm">
                    <input
                      type="checkbox"
                      checked={roleIds.includes(r.id)}
                      onChange={() => toggleRole(r.id)}
                    />
                    {roleLabel(r.code, r.name)}
                  </label>
                ))}
              </div>
            </FormField>
          </div>
          <div className="md:col-span-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-ink-primary">密码</p>
                <p className="mt-1 text-xs text-ink-secondary">
                  {mustChangePassword
                    ? `仍为初始密码 ${DEFAULT_INITIAL_PASSWORD}（该用户登录后必须修改）`
                    : passwordChangedAt
                      ? `用户已自行设置（上次修改：${formatDate(passwordChangedAt)}）`
                      : "用户已自行设置密码"}
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  管理员不能直接设定密码：只能「重置密码」回到初始密码 {DEFAULT_INITIAL_PASSWORD}，
                  用户下次登录将被强制修改（{PASSWORD_POLICY_DESCRIPTION}）。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setResetOpen(true)}
                disabled={!isActive}
                title={isActive ? undefined : "用户已停用，请先启用后再重置密码"}
                className={BUTTON_SECONDARY_CLASS + " disabled:cursor-not-allowed disabled:opacity-50"}
              >
                重置密码
              </button>
            </div>
          </div>
        </div>
      </section>
      <section className="rounded-md border border-border p-4">
        <h2 className="mb-1 text-sm font-semibold text-ink-primary">附加权限（可选）</h2>
        <p className="mb-3 text-xs text-ink-secondary">
          该用户的有效权限 = **所选角色权限** ∪ **此处勾选的附加权限**（并集，只增不减）。
          保存时按当前勾选全量替换附加授权；若要「取消」角色已授予的权限，请调整角色本身。
          权限变更在下一次请求/刷新后生效。
        </p>
        {unknownCodes.length > 0 ? (
          <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
            目录外权限码 {unknownCodes.length} 项（未在权限目录登记，已保留并在保存时原样提交）：
            <span className="font-mono"> {unknownCodes.join(", ")}</span>
          </p>
        ) : null}
        <PermissionTree
          items={catalog}
          selected={selected}
          onChange={(next) => {
            setSelected(next);
            setDirty(true);
          }}
        />
      </section>
      <ConfirmDialog
        open={resetOpen}
        title="重置密码"
        description={`将 ${email} 的密码重置为初始密码 ${DEFAULT_INITIAL_PASSWORD}，该用户下次登录必须立即修改密码。是否继续？`}
        confirmLabel="重置密码"
        tone="danger"
        busy={resetting}
        onConfirm={handleResetPassword}
        onCancel={() => setResetOpen(false)}
      />
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("user", "edit")}>
      <AppPage>
        <UserEditForm />
      </AppPage>
    </PermissionGuard>
  );
}