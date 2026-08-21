"use client";

/** Warehouses — 新建仓库（Master Data CRUD） */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";
import { useToast } from "@/components/ui/toast";

const inputClass = INPUT_CLASS;

function WarehouseCreateForm() {
  const router = useRouter();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [address, setAddress] = useState("");
  const [remark, setRemark] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  const handleSave = () => {
    if (submitting) return;
    if (!code.trim() || !name.trim()) {
      setError(new ApiClientError(400, "编码与名称为必填项", "VALIDATION"));
      return;
    }
    setSubmitting(true);
    setError(null);
    apiFetch<{ id: string }>("/api/warehouses", {
      method: "POST",
      body: JSON.stringify({
        code: code.trim(),
        name: name.trim(),
        type: type.trim() || null,
        address: address.trim() || null,
        remark: remark.trim() || null,
      }),
    })
      .then(() => {
        toast.success("仓库已创建");
        router.push("/warehouses");
      })
      .catch((err: unknown) => {
        const e = err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR");
        toast.error("创建失败", e.message);
        setError(e);
        setSubmitting(false);
      });
  };

  return (
    <AppPage maxWidth="4xl">
      <EntityFormWorkspace
        title="新建仓库"
        backHref="/warehouses"
        mode="create"
        submitting={submitting}
        error={error}
        dirty={dirty}
        onDirty={() => setDirty(true)}
        onSave={handleSave}
        onCancel={() => router.push("/warehouses")}
      >
        <section className="rounded-md border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink-primary">基本信息</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField label="编码" required>
              <input value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} placeholder="如 WH01" />
            </FormField>
            <FormField label="名称" required>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
            </FormField>
            <FormField label="类型">
              <input value={type} onChange={(e) => setType(e.target.value)} className={inputClass} placeholder="如 成品仓 / 原料仓 / 中转仓" />
            </FormField>
            <FormField label="地址">
              <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
            </FormField>
            <FormField label="备注">
              <input value={remark} onChange={(e) => setRemark(e.target.value)} className={inputClass} />
            </FormField>
          </div>
        </section>
      </EntityFormWorkspace>
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("warehouse", "create")}>
      <WarehouseCreateForm />
    </PermissionGuard>
  );
}
