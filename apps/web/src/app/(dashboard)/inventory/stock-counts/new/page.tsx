"use client";

/**
 * Stock Count Create — 新建库存盘点单（F2-6B 批 3 + UI-09 FE2.0 表单统一）
 *
 * 契约：POST /api/stock-counts（stock-count:create），仅 remark，创建即取号 CNT，初始 DRAFT。
 * 盘点行在详情页经 POST /lines 逐行录入（录入时服务端冻结五维快照）。
 * PermissionGuard 对齐 API requirePermission("stock-count:create")。
 *
 * UI-09：迁移至 EntityFormWorkspace（Dirty-State Guard / 409 冲突面板 / ErrorPanel /
 * 统一 Save/Cancel），移除页面级 window.confirm。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { FormField } from "@/components/ui/form-field";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { INPUT_CLASS } from "@/lib/ui-classes";

function StockCountCreateForm() {
  const router = useRouter();
  const [remark, setRemark] = useState("");
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = await apiFetch<{ id: string }>("/api/stock-counts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(remark.trim() ? { remark: remark.trim() } : {}) }),
      });
      setDirty(false);
      router.push(`/inventory/stock-counts/${body.data.id}`);
    } catch (err: unknown) {
      setError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "创建失败", "NETWORK_ERROR"),
      );
      setSubmitting(false);
    }
  };

  return (
    <EntityFormWorkspace
      title="新建库存盘点单"
      description="创建后进入 DRAFT；在详情页录入盘点行（录入时服务端冻结账面数量快照并计算差异），随后完成盘点。"
      backHref="/inventory/stock-counts"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSubmit}
      onCancel={() => router.push("/inventory/stock-counts")}
      saveLabel="创建盘点单"
    >
      <section className="rounded-md border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-primary">盘点信息</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="备注（可选，≤500）">
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={2}
              maxLength={500}
              className={INPUT_CLASS}
            />
          </FormField>
        </div>
      </section>
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("stock-count", "create")}>
      <AppPage>
        <StockCountCreateForm />
      </AppPage>
    </PermissionGuard>
  );
}
