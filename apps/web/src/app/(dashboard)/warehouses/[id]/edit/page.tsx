"use client";

/** Warehouses — 编辑仓库（Master Data CRUD；CAS 乐观锁；被引用后仍可编辑） */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";
import { useToast } from "@/components/ui/toast";
import { PageLoading } from "@/components/ui/skeleton";

const inputClass = INPUT_CLASS;

interface WarehouseDetail {
  id: string;
  code: string;
  name: string;
  type: string | null;
  address: string | null;
  remark: string | null;
  isActive: boolean;
  version: number;
}

function WarehouseEditForm() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const toast = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [address, setAddress] = useState("");
  const [remark, setRemark] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    apiFetch<WarehouseDetail>(`/api/warehouses/${id}`)
      .then((body) => {
        const d = body.data;
        setCode(d.code);
        setName(d.name);
        setType(d.type ?? "");
        setAddress(d.address ?? "");
        setRemark(d.remark ?? "");
        setIsActive(d.isActive);
        setVersion(d.version);
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
    apiFetch<{ id: string }>(`/api/warehouses/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        version,
        code: code.trim(),
        name: name.trim(),
        type: type.trim() || null,
        address: address.trim() || null,
        remark: remark.trim() || null,
        isActive,
      }),
    })
      .then(() => {
        toast.success("仓库已保存");
        router.push("/warehouses");
      })
      .catch((err: unknown) => {
        const e = err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR");
        toast.error("保存失败", e.message);
        setError(e);
        setSubmitting(false);
      });
  };

  if (loading) {
    return (
      <AppPage maxWidth="4xl">
        <EntityFormWorkspace title="编辑仓库" backHref="/warehouses" mode="edit" submitting={false} onSave={handleSave} onCancel={() => router.push("/warehouses")}>
          <PageLoading rows={4} />
        </EntityFormWorkspace>
      </AppPage>
    );
  }

  if (loadError) {
    return (
      <AppPage maxWidth="4xl">
        <EntityFormWorkspace title="编辑仓库" backHref="/warehouses" mode="edit" submitting={false} error={loadError} onSave={handleSave} onCancel={() => router.push("/warehouses")}>
          <p className="px-4 py-6 text-sm text-ink-secondary">加载失败</p>
        </EntityFormWorkspace>
      </AppPage>
    );
  }

  return (
    <AppPage maxWidth="4xl">
      <EntityFormWorkspace
        title="编辑仓库"
        description={`编码：${code}`}
        backHref="/warehouses"
        mode="edit"
        submitting={submitting}
        error={error}
        dirty={dirty}
        onDirty={() => setDirty(true)}
        onReload={() => { load(); setError(null); }}
        onSave={handleSave}
        onCancel={() => router.push("/warehouses")}
      >
        <section className="rounded-md border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink-primary">基本信息</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField label="编码" required>
              <input value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} />
            </FormField>
            <FormField label="名称" required>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
            </FormField>
            <FormField label="类型">
              <input value={type} onChange={(e) => setType(e.target.value)} className={inputClass} />
            </FormField>
            <FormField label="地址">
              <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
            </FormField>
            <FormField label="备注">
              <input value={remark} onChange={(e) => setRemark(e.target.value)} className={inputClass} />
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
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("warehouse", "edit")}>
      <WarehouseEditForm />
    </PermissionGuard>
  );
}
