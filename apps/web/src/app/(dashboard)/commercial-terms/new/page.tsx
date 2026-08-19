"use client";

/** Commercial Terms — 新建商业条款（Pending Pages Completion Gate — Batch 1） */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { INPUT_CLASS } from "@/lib/ui-classes";

const inputClass = INPUT_CLASS;

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-ink-secondary">
        {label}
        {required ? <span className="ml-0.5 text-status-danger-text">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function CommercialTermCreateForm() {
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
    apiFetch<{ id: string }>("/api/commercial-terms", {
      method: "POST",
      body: JSON.stringify(payload),
    })
      .then(() => router.push("/commercial-terms"))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  return (
    <EntityFormWorkspace
      title="新建商业条款"
      description="维护 EXW/FOB/CIF 等贸易术语与结算条款"
      backHref="/commercial-terms"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSave}
      onCancel={() => router.push("/commercial-terms")}
    >
      <section className="rounded-md border border-border p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="编码" required>
            <input value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} placeholder="如 EXW/FOB/CIF" />
          </Field>
          <Field label="名称" required>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </Field>
          <div className="md:col-span-2">
            <Field label="描述">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} rows={3} />
            </Field>
          </div>
        </div>
      </section>
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("commercial-term", "create")}>
      <AppPage>
        <CommercialTermCreateForm />
      </AppPage>
    </PermissionGuard>
  );
}