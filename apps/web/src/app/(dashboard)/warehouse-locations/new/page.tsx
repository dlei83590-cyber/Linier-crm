"use client";

/** Warehouse Locations — 新建库位（主数据 CRUD） */
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { PERMISSIONS } from "@nilier-crm/shared";

const inputClass = INPUT_CLASS;

interface WarehouseOption {
  id: string;
  code: string | null;
  name: string | null;
}

function LocationCreateForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetWarehouseId = searchParams.get("warehouseId") ?? "";

  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [warehouseId, setWarehouseId] = useState(presetWarehouseId);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<WarehouseOption[]>("/api/warehouses?pageSize=100&isActive=true", { signal: controller.signal })
      .then((body) => setWarehouses(body.data))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载仓库失败", "NETWORK_ERROR"));
      });
    return () => controller.abort();
  }, []);

  const handleSave = () => {
    if (submitting) return;
    if (!warehouseId || !code.trim() || !name.trim()) {
      setError(new ApiClientError(400, "仓库、编码与名称为必填项", "VALIDATION"));
      return;
    }
    setSubmitting(true);
    setError(null);
    const payload: Record<string, unknown> = {
      warehouseId,
      code: code.trim(),
      name: name.trim(),
    };
    apiFetch<{ id: string }>("/api/warehouse-locations", {
      method: "POST",
      body: JSON.stringify(payload),
    })
      .then(() => router.push("/warehouse-locations"))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  return (
    <EntityFormWorkspace
      title="新建库位"
      description="维护仓库下的存储库位（编码在同一仓库内唯一）"
      backHref="/warehouse-locations"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSave}
      onCancel={() => router.push("/warehouse-locations")}
    >
      <section className="rounded-md border border-border p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="所属仓库" required>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={SELECT_CLASS}>
              <option value="">请选择仓库</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name ?? w.code}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="库位编码" required>
            <input value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} placeholder="如 A-01 / 原料区-1" />
          </FormField>
          <FormField label="名称" required>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="如 原料区一号位" />
          </FormField>
        </div>
      </section>
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("warehouse-location", "create")}>
      <AppPage>
        <Suspense fallback={null}>
          <LocationCreateForm />
        </Suspense>
      </AppPage>
    </PermissionGuard>
  );
}
