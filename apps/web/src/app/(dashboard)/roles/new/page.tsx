"use client";

/**
 * Roles — 新建角色 + 权限分配
 *
 * 权限树数据源：GET /api/permissions（DB Permission 目录，与静态 RBAC 目录对齐）。
 * 提交：POST /api/roles { code, name, description?, permissionCodes[] }（未知 code → 400，不做客户端裁剪）。
 *
 * 生效边界（如实声明）：本轮 permissionCodes 落库 + 审计留痕；
 * 运行时鉴权仍使用 packages/shared 静态角色权限映射（动态鉴权为后续 ADR 范围）。
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { PageLoading } from "@/components/ui/skeleton";
import { PermissionTree } from "@/components/system/permission-tree";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";
import { selectedCodeList, type PermissionCatalogItem } from "@/lib/frontend/permission-tree";

const inputClass = INPUT_CLASS;

function RoleCreateForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [catalog, setCatalog] = useState<PermissionCatalogItem[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set<string>());
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<ApiClientError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    apiFetch<{ items: PermissionCatalogItem[]; total: number }>("/api/permissions")
      .then((body) => {
        setCatalog(body.data.items);
        setCatalogLoading(false);
      })
      .catch((err: unknown) => {
        setCatalogError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setCatalogLoading(false);
      });
  }, []);

  const handleSave = () => {
    if (submitting) return;
    if (!code.trim() || !name.trim()) {
      setError(new ApiClientError(400, "编码与名称为必填项", "VALIDATION"));
      return;
    }
    setSubmitting(true);
    setError(null);
    const permissionCodes = selectedCodeList(selected);
    const payload: Record<string, unknown> = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      description: description.trim() || undefined,
      ...(permissionCodes.length > 0 ? { permissionCodes } : {}),
    };
    apiFetch<{ id: string }>("/api/roles", {
      method: "POST",
      body: JSON.stringify(payload),
    })
      .then(() => router.push("/roles"))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  return (
    <EntityFormWorkspace
      title="新建角色"
      description="角色编码须为大写字母/数字/下划线；权限可按域/模块/动作勾选分配"
      backHref="/roles"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSave}
      onCancel={() => router.push("/roles")}
    >
      <section className="rounded-md border border-border p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="编码" required>
            <input value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} placeholder="如 OPERATOR" />
          </FormField>
          <FormField label="名称" required>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </FormField>
          <div className="md:col-span-2">
            <FormField label="描述">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} rows={3} />
            </FormField>
          </div>
        </div>
      </section>
      <section className="rounded-md border border-border p-4">
        <h2 className="mb-1 text-sm font-semibold text-ink-primary">权限分配</h2>
        <p className="mb-3 text-xs text-ink-secondary">
          勾选权限码保存到角色（RolePermissions）。分配随保存提交并由审计日志留痕；
          运行时鉴权当前仍以角色静态权限映射为准（动态鉴权待后续 ADR）。
        </p>
        {catalogLoading ? (
          <PageLoading rows={3} />
        ) : catalogError ? (
          <p className="text-sm text-rose-600">权限目录加载失败：{catalogError.message}</p>
        ) : (
          <PermissionTree
            items={catalog}
            selected={selected}
            onChange={(next) => {
              setSelected(next);
              setDirty(true);
            }}
          />
        )}
      </section>
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("role", "create")}>
      <AppPage>
        <RoleCreateForm />
      </AppPage>
    </PermissionGuard>
  );
}
