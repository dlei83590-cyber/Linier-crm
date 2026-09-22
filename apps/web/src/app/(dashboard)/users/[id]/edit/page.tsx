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
import { INPUT_CLASS } from "@/lib/ui-classes";
import { roleLabel } from "@/lib/frontend/labels";
import { PermissionTree } from "@/components/system/permission-tree";
import { selectedCodeList, type PermissionCatalogItem } from "@/lib/frontend/permission-tree";

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
}

const inputClass = INPUT_CLASS;


function UserEditForm() {
  const router = useRouter();
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
  const [password, setPassword] = useState("");
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
      ...(password ? { password } : {}),
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
          <FormField label="重置密码（留空不修改）">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} placeholder="至少 6 位" />
          </FormField>
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