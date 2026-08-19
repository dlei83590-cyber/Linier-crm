"use client";

/** Roles — 编辑角色（Pending Pages Completion Gate — Batch 2；无 CAS；权限只读分组展示） */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";
import { moduleLabel, permissionLabel } from "@/lib/frontend/labels";

interface RolePermission {
  id: string;
  code: string;
  module: string;
  name: string;
}

interface RoleDetail {
  id: string;
  code: string;
  name: string;
  description: string | null;
  permissions: RolePermission[];
  _count?: { users: number };
}

const inputClass = INPUT_CLASS;


function RoleEditForm() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [permissions, setPermissions] = useState<RolePermission[]>([]);
  const [userCount, setUserCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    apiFetch<RoleDetail>(`/api/roles/${id}`)
      .then((body) => {
        const d = body.data;
        setCode(d.code);
        setName(d.name);
        setDescription(d.description ?? "");
        setPermissions(d.permissions);
        setUserCount(d._count?.users ?? 0);
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

  const handleSave = () => {
    if (submitting) return;
    if (!name.trim()) {
      setError(new ApiClientError(400, "名称为必填项", "VALIDATION"));
      return;
    }
    setSubmitting(true);
    setError(null);
    const payload: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim() || null,
    };
    apiFetch<{ id: string }>(`/api/roles/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    })
      .then(() => router.push("/roles"))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  // 权限按 module 分组（只读展示）
  const grouped = permissions.reduce<Record<string, RolePermission[]>>((acc, p) => {
    (acc[p.module] = acc[p.module] ?? []).push(p);
    return acc;
  }, {});

  if (loading) {
    return (
      <EntityFormWorkspace title="编辑角色" backHref="/roles" mode="edit" submitting={false} onSave={handleSave} onCancel={() => router.push("/roles")}>
        <p className="px-4 py-6 text-sm text-ink-secondary">加载中…</p>
      </EntityFormWorkspace>
    );
  }

  if (loadError) {
    return (
      <EntityFormWorkspace title="编辑角色" backHref="/roles" mode="edit" submitting={false} error={loadError} onSave={handleSave} onCancel={() => router.push("/roles")}>
        <p className="px-4 py-6 text-sm text-ink-secondary">加载失败</p>
      </EntityFormWorkspace>
    );
  }

  return (
    <EntityFormWorkspace
      title="编辑角色"
      description={`编码：${code} ｜ 关联用户：${userCount} ｜ 权限：${permissions.length} 项`}
      backHref="/roles"
      mode="edit"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSave}
      onCancel={() => router.push("/roles")}
    >
      <section className="rounded-md border border-border p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="编码">
            <input value={code} readOnly className={`${inputClass} bg-slate-50`} />
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
        <h2 className="mb-2 text-sm font-semibold text-ink-primary">权限映射（只读，由系统治理）</h2>
        <p className="mb-3 text-xs text-ink-secondary">权限分配由 seed/ADMIN 配置治理；此处仅展示当前角色权限。</p>
        {Object.keys(grouped).length === 0 ? (
          <p className="text-sm text-ink-secondary">该角色暂无权限。</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(grouped).map(([module, list]) => (
              <div key={module} className="rounded-md border border-border p-2">
                <div className="mb-1 text-xs font-medium text-ink-secondary">{moduleLabel(module)}（{list.length}）</div>
                <div className="flex flex-wrap gap-1">
                  {list.map((p) => (
                    <span key={p.id} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-ink-secondary">
                      {permissionLabel(p.code)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("role", "edit")}>
      <AppPage>
        <RoleEditForm />
      </AppPage>
    </PermissionGuard>
  );
}