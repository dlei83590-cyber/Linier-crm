"use client";

/** Technical Standards — 编辑技术标准（Pending Pages Completion Gate — Batch 1；CAS version） */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";

interface TechnicalStandardDetail {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  version: number;
}

const inputClass =
  "w-full rounded-md border border-border px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted focus:border-brand-500 focus:outline-none";

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

function TechnicalStandardEditForm() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
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
    apiFetch<TechnicalStandardDetail>(`/api/technical-standards/${id}`)
      .then((body) => {
        const d = body.data;
        setCode(d.code);
        setName(d.name);
        setDescription(d.description ?? "");
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
    const payload: Record<string, unknown> = {
      version,
      code: code.trim() || undefined,
      name: name.trim(),
      description: description.trim() || null,
      isActive,
    };
    apiFetch<{ id: string }>(`/api/technical-standards/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    })
      .then(() => router.push("/technical-standards"))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  if (loading) {
    return (
      <EntityFormWorkspace title="编辑技术标准" backHref="/technical-standards" mode="edit" submitting={false} onSave={handleSave} onCancel={() => router.push("/technical-standards")}>
        <p className="px-4 py-6 text-sm text-ink-secondary">加载中…</p>
      </EntityFormWorkspace>
    );
  }

  if (loadError) {
    return (
      <EntityFormWorkspace title="编辑技术标准" backHref="/technical-standards" mode="edit" submitting={false} error={loadError} onSave={handleSave} onCancel={() => router.push("/technical-standards")}>
        <p className="px-4 py-6 text-sm text-ink-secondary">加载失败</p>
      </EntityFormWorkspace>
    );
  }

  return (
    <EntityFormWorkspace
      title="编辑技术标准"
      description={`编码：${code}`}
      backHref="/technical-standards"
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
      onCancel={() => router.push("/technical-standards")}
    >
      <section className="rounded-md border border-border p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="编码" required>
            <input value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} />
          </Field>
          <Field label="名称" required>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </Field>
          <div className="md:col-span-2">
            <Field label="描述">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} rows={3} />
            </Field>
          </div>
          <Field label="启用">
            <select value={isActive ? "true" : "false"} onChange={(e) => setIsActive(e.target.value === "true")} className={inputClass}>
              <option value="true">是</option>
              <option value="false">否</option>
            </select>
          </Field>
        </div>
      </section>
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("technical-standard", "edit")}>
      <AppPage>
        <TechnicalStandardEditForm />
      </AppPage>
    </PermissionGuard>
  );
}