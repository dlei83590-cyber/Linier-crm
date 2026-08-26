"use client";

/**
 * FRT-03 — 新建公海池（GLOBAL / REGION / DEPARTMENT）
 *
 * - REGION：继续使用真实区域值（客户档案 BusinessPartner.region 字符串，OQ-1 不建字典）；
 * - DEPARTMENT：真实 Department selector（禁手打 Department ID）；
 * - 页面明确自动规则：REGION（客户区域 = 公海区域）与 DEPARTMENT（客户负责人所属部门 = 公海部门）均自动入池。
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";
import { useToast } from "@/components/ui/toast";

const SCOPE_OPTIONS = [
  { value: "GLOBAL", label: "全局（不限制范围）" },
  { value: "REGION", label: "区域（按客户区域字符串）" },
  { value: "DEPARTMENT", label: "部门（按客户负责人部门自动入池）" },
];

interface DepartmentOption {
  id: string;
  code: string;
  name: string;
}

function PoolCreateForm() {
  const router = useRouter();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scopeType, setScopeType] = useState("GLOBAL");
  const [scopeValue, setScopeValue] = useState("");
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [deptLoadError, setDeptLoadError] = useState<string | null>(null);
  const [deptLoading, setDeptLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  const loadDepartments = () => {
    setDeptLoading(true);
    setDeptLoadError(null);
    apiFetch<DepartmentOption[]>("/api/departments?pageSize=100")
      .then(({ data }) => setDepartments(data))
      .catch((err: unknown) =>
        setDeptLoadError(err instanceof ApiClientError ? err.message : "部门列表加载失败"),
      )
      .finally(() => setDeptLoading(false));
  };

  useEffect(() => {
    if (scopeType === "DEPARTMENT" && departments.length === 0) loadDepartments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeType]);

  const handleSave = () => {
    if (submitting) return;
    if (!code.trim() || !name.trim()) {
      setError(new ApiClientError(400, "编码与名称为必填项", "VALIDATION"));
      return;
    }
    if (scopeType === "DEPARTMENT" && !scopeValue.trim()) {
      setError(new ApiClientError(400, "请选择部门", "VALIDATION"));
      return;
    }
    if (scopeType === "REGION" && !scopeValue.trim()) {
      setError(new ApiClientError(400, "请填写区域值（如：华东）", "VALIDATION"));
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
        scopeValue: scopeType === "DEPARTMENT" ? scopeValue : scopeValue.trim() || null,
      }),
    })
      .then(({ data }) => {
        toast.success("公海池创建成功", `${code.trim()}（${name.trim()}）已创建`);
        router.push("/customer-pools/" + data.id);
      })
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
      {/* FRT-03 #8：自动匹配能力如实说明，不虚报 */}
      <div className="rounded-md border border-status-info-border bg-status-info-bg p-3 text-sm text-status-info-text">
        自动匹配说明：当前支持 <strong>REGION 自动入池</strong>（客户区域 = 公海区域字符串即自动进入公海）
        与 <strong>DEPARTMENT 自动入池</strong>（客户负责人所属部门 = 公海部门即自动进入公海），
        命中后来源标记「规则自动」。GLOBAL 公海不自动入池；手工入池适用于全部类型公海。
      </div>
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

          {scopeType === "DEPARTMENT" ? (
            <FormField label="部门" required hint="选择部门；客户负责人属于该部门时自动入池；手工入池要求操作者部门一致">
              {deptLoading ? (
                <p className="text-sm text-ink-muted">部门列表加载中…</p>
              ) : deptLoadError ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-status-danger-text">部门列表加载失败：{deptLoadError}</span>
                  <button
                    type="button"
                    onClick={loadDepartments}
                    className="text-sm text-brand-600 hover:underline"
                  >
                    重试
                  </button>
                </div>
              ) : (
                <select
                  value={scopeValue}
                  onChange={(e) => setScopeValue(e.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value="">请选择部门</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}（{d.code}）
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          ) : (
            <FormField
              label="范围值"
              hint={scopeType === "REGION" ? "填写客户档案中的真实区域字符串（如：华东），新建客户区域一致即自动入池" : "全局池留空"}
            >
              <input
                value={scopeValue}
                onChange={(e) => setScopeValue(e.target.value)}
                className={INPUT_CLASS}
                placeholder={scopeType === "REGION" ? "如：华东" : ""}
                disabled={scopeType === "GLOBAL"}
              />
            </FormField>
          )}

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
