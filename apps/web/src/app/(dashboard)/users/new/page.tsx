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
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiFetch<DepartmentOption[]>("/api/departments?pageSize=100", { signal: controller.signal }),
      apiFetch<RoleOption[]>("/api/roles?pageSize=100", { signal: controller.signal }),
    ])
      .then(([deptBody, roleBody]) => {
        setDepts(deptBody.data);
        setRoles(roleBody.data);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const toggleRole = (roleId: string) => {
    setRoleIds((prev) => (prev.includes(roleId) ? prev.filter((r) => r !== roleId) : [...prev, roleId]));
  };

  const handleSave = () => {
    if (submitting) return;
    if (!email.trim() || !password) {
      setError(new ApiClientError(400, "邮箱与密码为必填项", "VALIDATION"));
      return;
    }
    setSubmitting(true);
    setError(null);
    const payload: Record<string, unknown> = {
      email: email.trim(),
      password,
      name: name.trim() || undefined,
      departmentId: departmentId || undefined,
      roleIds: roleIds.length > 0 ? roleIds : undefined,
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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="邮箱" required>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </FormField>
          <FormField label="初始密码" required>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} placeholder="至少 6 位" />
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