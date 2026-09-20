"use client";

/**
 * Roles — 编辑角色 + 权限分配（权限树）
 *
 * - 权限树数据源：GET /api/permissions（DB Permission 目录）
 * - 已分配：GET /api/roles/:id → permissions（code 列表）
 * - 保存：PATCH /api/roles/:id { name, description?, permissionCodes[] }（**全量替换** RolePermissions）
 *
 * 红线：目录外的历史权限码（未在 Permission 目录登记）不允许被静默丢弃——
 * 一律保留在选择集中并在界面显式列出，保存时原样提交。
 *
 * 生效边界（如实声明）：permissionCodes 落库 + 审计留痕；
 * 运行时鉴权仍使用 packages/shared 静态角色权限映射（动态鉴权为后续 ADR 范围）。
 */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { PageLoading } from "@/components/ui/skeleton";
import { PermissionTree } from "@/components/system/permission-tree";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";
import { roleLabel } from "@/lib/frontend/labels";
import { selectedCodeList, type PermissionCatalogItem } from "@/lib/frontend/permission-tree";

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
  const { state } = useSession();
  const canEdit =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("role", "edit"));

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [userCount, setUserCount] = useState(0);
  const [catalog, setCatalog] = useState<PermissionCatalogItem[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set<string>());
  const [unknownCodes, setUnknownCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      apiFetch<RoleDetail>(`/api/roles/${id}`),
      apiFetch<{ items: PermissionCatalogItem[]; total: number }>("/api/permissions"),
    ])
      .then(([roleBody, catalogBody]) => {
        const d = roleBody.data;
        const items = catalogBody.data.items;
        const catalogCodes = new Set(items.map((p) => p.code));
        const assigned = d.permissions.map((p) => p.code);
        setCode(d.code);
        setName(d.name);
        setDescription(d.description ?? "");
        setUserCount(d._count?.users ?? 0);
        setCatalog(items);
        // 目录外历史权限码保留在选择集中（禁止静默丢弃）
        setSelected(new Set(assigned));
        setUnknownCodes(assigned.filter((c) => !catalogCodes.has(c)).sort());
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
      permissionCodes: selectedCodeList(selected),
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

  if (loading) {
    return (
      <EntityFormWorkspace title="编辑角色" backHref="/roles" mode="edit" submitting={false} onSave={handleSave} onCancel={() => router.push("/roles")}>
        <PageLoading rows={4} />
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
      description={`${roleLabel(code, name)}（${code}）｜ 关联用户：${userCount} ｜ 已分配权限：${selected.size} 项`}
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
            <input value={code} readOnly className={`${inputClass} bg-canvas`} />
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
          保存时按当前勾选「全量替换」该角色权限。分配由审计日志留痕（含新增/移除）。
          运行时鉴权当前仍以角色静态权限映射为准（动态鉴权待后续 ADR）。
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
          readOnly={!canEdit}
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
    <PermissionGuard permission={actionPermission("role", "edit")}>
      <AppPage>
        <RoleEditForm />
      </AppPage>
    </PermissionGuard>
  );
}
