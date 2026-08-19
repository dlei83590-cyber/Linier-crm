"use client";

/** Technical Standards — 新建技术标准（Pending Pages Completion Gate — Batch 1） */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";

const inputClass = INPUT_CLASS;


function TechnicalStandardCreateForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
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
    const payload: Record<string, unknown> = {
      code: code.trim(),
      name: name.trim(),
      description: description.trim() || undefined,
    };
    apiFetch<{ id: string }>("/api/technical-standards", {
      method: "POST",
      body: JSON.stringify(payload),
    })
      .then(() => router.push("/technical-standards"))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  return (
    <EntityFormWorkspace
      title="新建技术标准"
      description="维护行业/企业技术标准，供物料引用"
      backHref="/technical-standards"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSave}
      onCancel={() => router.push("/technical-standards")}
    >
      <section className="rounded-md border border-border p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="编码" required>
            <input value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} placeholder="唯一编码" />
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
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("technical-standard", "create")}>
      <AppPage>
        <TechnicalStandardCreateForm />
      </AppPage>
    </PermissionGuard>
  );
}