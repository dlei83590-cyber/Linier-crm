"use client";

/** Warehouse Locations — 编辑库位（主数据 CRUD；CAS version） */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { PageLoading } from "@/components/ui/skeleton";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";

interface LocationDetail {
  id: string;
  warehouseId: string;
  code: string;
  name: string;
  isActive: boolean;
  warehouse?: { id: string; code: string | null; name: string | null } | null;
  version: number;
}

const inputClass = INPUT_CLASS;

function LocationEditForm() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [version, setVersion] = useState(0);
  const [warehouseLabel, setWarehouseLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    apiFetch<LocationDetail>("/api/warehouse-locations/" + id)
      .then((body) => {
        const d = body.data;
        setCode(d.code);
        setName(d.name);
        setIsActive(d.isActive);
        setVersion(d.version);
        setWarehouseLabel(d.warehouse?.name ?? d.warehouse?.code ?? "");
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
      version,
      code: code.trim() || undefined,
      name: name.trim(),
      isActive,
    };
    apiFetch<{ id: string }>("/api/warehouse-locations/" + id, {
      method: "PATCH",
      body: JSON.stringify(payload),
    })
      .then(() => router.push("/warehouse-locations"))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  if (loading) {
    return (
      <EntityFormWorkspace title="编辑库位" backHref="/warehouse-locations" mode="edit" submitting={false} onSave={handleSave} onCancel={() => router.push("/warehouse-locations")}>
        <PageLoading rows={4} />
      </EntityFormWorkspace>
    );
  }

  if (loadError) {
    return (
      <EntityFormWorkspace title="编辑库位" backHref="/warehouse-locations" mode="edit" submitting={false} error={loadError} onSave={handleSave} onCancel={() => router.push("/warehouse-locations")}>
        <p className="px-4 py-6 text-sm text-ink-secondary">加载失败</p>
      </EntityFormWorkspace>
    );
  }

  return (
    <EntityFormWorkspace
      title="编辑库位"
      description={"编码：" + code + (warehouseLabel ? " ｜ 仓库：" + warehouseLabel : "")}
      backHref="/warehouse-locations"
      mode="edit"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onReload={() => {
        load();
        setError(null);
      }}
      onSave={handleSave}
      onCancel={() => router.push("/warehouse-locations")}
    >
      <section className="rounded-md border border-border p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="库位编码" required>
            <input value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} />
          </FormField>
          <FormField label="名称" required>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </FormField>
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
    <PermissionGuard permission={actionPermission("warehouse-location", "edit")}>
      <AppPage>
        <LocationEditForm />
      </AppPage>
    </PermissionGuard>
  );
}
