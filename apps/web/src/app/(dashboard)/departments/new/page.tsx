"use client";

/** Departments — 新建部门（Pending Pages Completion Gate — Batch 2） */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";

interface DepartmentOption {
  id: string;
  code: string;
  name: string;
}

const inputClass = INPUT_CLASS;


function DepartmentCreateForm() {
  const router = useRouter();
  const [depts, setDepts] = useState<DepartmentOption[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<DepartmentOption[]>("/api/departments?pageSize=100", { signal: controller.signal })
      .then((body) => setDepts(body.data))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

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
      parentId: parentId || undefined,
    };
    apiFetch<{ id: string }>("/api/departments", {
      method: "POST",
      body: JSON.stringify(payload),
    })
      .then(() => router.push("/departments"))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  return (
    <EntityFormWorkspace
      title="新建部门"
      description="维护组织架构与部门层级关系"
      backHref="/departments"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSave}
      onCancel={() => router.push("/departments")}
    >
      <section className="rounded-md border border-border p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="编码" required>
            <input value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} placeholder="唯一编码" />
          </FormField>
          <FormField label="名称" required>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </FormField>
          <FormField label="上级部门">
            <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={inputClass}>
              <option value="">顶级部门</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </FormField>
        </div>
      </section>
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("department", "create")}>
      <AppPage>
        <DepartmentCreateForm />
      </AppPage>
    </PermissionGuard>
  );
}