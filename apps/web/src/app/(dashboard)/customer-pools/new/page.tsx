"use client";

/**
 * Phase 2C — 新建公海池（GLOBAL / REGION / DEPARTMENT；OQ-1：REGION 区域字符串）
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";

const SCOPE_OPTIONS = [
  { value: "GLOBAL", label: "全局（不限制范围）" },
  { value: "REGION", label: "区域（按客户区域字符串）" },
  { value: "DEPARTMENT", label: "部门（按操作者部门）" },
];

function PoolCreateForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scopeType, setScopeType] = useState("GLOBAL");
  const [scopeValue, setScopeValue] = useState("");
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
    apiFetch<{ id: string }>("/api/customer-pools", {
      method: "POST",
      body: JSON.stringify({
        code: code.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        scopeType,
        scopeValue: scopeValue.trim() || null,
      }),
    })
      .then(({ data }) => router.push("/customer-pools/" + data.id))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  return (
    <EntityFormWorkspace
      title="新建公海池"
      description="多公海定义：GLOBAL / REGION（区域字符串 EQ）/ DEPARTMENT（部门）"
      backHref="/customer-pools"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSave}
      onCancel={() => router.push("/customer-pools")}
    >
      <section className="rounded-md border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-primary">基本信息</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="编码" required>
            <input value={code} onChange={(e) => setCode(e.target.value)} className={INPUT_CLASS} placeholder="唯一池编码" />
          </FormField>
          <FormField label="名称" required>
            <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLASS} />
          </FormField>
          <FormField label="范围类型">
            <select value={scopeType} onChange={(e) => setScopeType(e.target.value)} className={INPUT_CLASS}>
              {SCOPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </FormField>
          <FormField label="范围值">
            <input
              value={scopeValue}
              onChange={(e) => setScopeValue(e.target.value)}
              className={INPUT_CLASS}
              placeholder={scopeType === "GLOBAL" ? "全局池留空" : scopeType === "REGION" ? "如：华东" : "部门 ID"}
              disabled={scopeType === "GLOBAL"}
            />
          </FormField>
          <FormField label="描述">
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={INPUT_CLASS} />
          </FormField>
        </div>
      </section>
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("customer-pool", "create")}>
      <AppPage>
        <PoolCreateForm />
      </AppPage>
    </PermissionGuard>
  );
}
