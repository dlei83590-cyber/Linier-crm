"use client";

/** Users — 新建用户（Pending Pages Completion Gate — Batch 2） */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";
import { roleLabel } from "@/lib/frontend/labels";
import { PermissionTree } from "@/components/system/permission-tree";
import { selectedCodeList, type PermissionCatalogItem } from "@/lib/frontend/permission-tree";
import { DEFAULT_INITIAL_PASSWORD, PASSWORD_POLICY_DESCRIPTION } from "@nilier-crm/shared";

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

const inputClass = INPUT_CLASS;


function UserCreateForm() {
  const router = useRouter();
  const [depts, setDepts] = useState<DepartmentOption[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  // ADR-0058：用户附加授权（与所选角色权限并集生效）
  const [catalog, setCatalog] = useState<PermissionCatalogItem[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set<string>());
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiFetch<DepartmentOption[]>("/api/departments?pageSize=100", { signal: controller.signal }),
      apiFetch<RoleOption[]>("/api/roles?pageSize=100", { signal: controller.signal }),
      // ADR-0058：权限目录（附加授权勾选）
      apiFetch<{ items: PermissionCatalogItem[]; total: number }>("/api/permissions", { signal: controller.signal }),
    ])
      .then(([deptBody, roleBody, permissionBody]) => {
        setDepts(deptBody.data);
        setRoles(roleBody.data);
        setCatalog(permissionBody.data.items);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const toggleRole = (roleId: string) => {
    setRoleIds((prev) => (prev.includes(roleId) ? prev.filter((r) => r !== roleId) : [...prev, roleId]));
  };

  const handleSave = () => {
    if (submitting) return;
    if (!email.trim()) {
      setError(new ApiClientError(400, "邮箱为必填项", "VALIDATION"));
      return;
    }
    setSubmitting(true);
    setError(null);
    // ADR-0059：不提交任何密码——初始密码由服务端固定为 123456 并强制首次登录改密
    const payload: Record<string, unknown> = {
      email: email.trim(),
      name: name.trim() || undefined,
      departmentId: departmentId || undefined,
      roleIds: roleIds.length > 0 ? roleIds : undefined,
      ...(selected.size > 0 ? { permissionCodes: selectedCodeList(selected) } : {}),
      isActive,
    };
    apiFetch<{ id: string }>("/api/users", {
      method: "POST",
      body: JSON.stringify(payload),
    })
      .then(() => router.push("/users"))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  return (
    <EntityFormWorkspace
      title="新建用户"
      description="创建平台用户账号（密码由服务端加密存储）"
      backHref="/users"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSave}
      onCancel={() => router.push("/users")}
    >
      <section className="rounded-md border border-border p-4">
        <p className="mb-3 rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs text-status-info-text">
          新用户初始密码为 <span className="font-mono font-semibold">{DEFAULT_INITIAL_PASSWORD}</span>，
          该用户首次登录时将被强制修改密码（{PASSWORD_POLICY_DESCRIPTION}）。
          管理员无法代设密码；用户忘记密码时请在编辑页使用「重置密码」。
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="邮箱" required>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </FormField>
          <FormField label="初始密码" hint={`固定为 ${DEFAULT_INITIAL_PASSWORD}（由系统生成，不可自定义）`}>
            <input value={DEFAULT_INITIAL_PASSWORD} readOnly className={`${inputClass} bg-canvas`} />
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
          <FormField label="启用">
            <select value={isActive ? "true" : "false"} onChange={(e) => setIsActive(e.target.value === "true")} className={inputClass}>
              <option value="true">是</option>
              <option value="false">否</option>
            </select>
          </FormField>
        </div>
      </section>
      <section className="rounded-md border border-border p-4">
        <h2 className="mb-1 text-sm font-semibold text-ink-primary">附加权限（可选）</h2>
        <p className="mb-3 text-xs text-ink-secondary">
          该用户的有效权限 = **所选角色权限** ∪ **此处勾选的附加权限**（并集，只增不减）。
          若要「取消」角色已授予的权限，请调整角色本身；权限变更在下一次请求/刷新后生效。
        </p>
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
    <PermissionGuard permission={actionPermission("user", "create")}>
      <AppPage>
        <UserCreateForm />
      </AppPage>
    </PermissionGuard>
  );
}