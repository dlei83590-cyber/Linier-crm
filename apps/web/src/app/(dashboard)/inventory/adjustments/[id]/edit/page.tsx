"use client";

/**
 * Inventory Adjustment Edit — 编辑库存调整单（F2-6B 批 3 + UI-09 FE2.0 表单统一，头字段）
 *
 * 契约：PATCH /api/inventory-adjustments/:id，仅 DRAFT，乐观锁 version CAS。
 * 可编辑：reasonCode / remark（行整体替换本轮不做，创建后行如需调整请取消后新建）。
 * PermissionGuard 对齐 API requirePermission("inventory-adjustment:edit")。
 *
 * UI-09：迁移至 EntityFormWorkspace（Dirty-State Guard / 409 冲突面板 / ErrorPanel /
 * 统一 Save/Cancel），移除页面级 window.confirm。
 */
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { FormField } from "@/components/ui/form-field";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { INPUT_CLASS } from "@/lib/ui-classes";

/** 状态中文业务名（Business UX Rationalization：枚举展示中文，不展示数据库枚举值；key 保留真实 enum） */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "已提交",
  APPROVED: "已批准",
  APPLIED: "已应用",
  CANCELLED: "已取消",
};

interface AdjustmentDetail {
  id: string;
  version: number;
  adjustmentNo: string;
  status: string;
  reasonCode: string;
  remark?: string | null;
}

const REASON_CODES = ["COUNT_VARIANCE", "DAMAGE", "LOSS", "GIFT", "SYSTEM_CORRECTION", "MANUAL"];

function AdjustmentEditForm() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const [detail, setDetail] = useState<AdjustmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [notEditable, setNotEditable] = useState(false);
  const [reasonCode, setReasonCode] = useState("MANUAL");
  const [remark, setRemark] = useState("");
  const [init, setInit] = useState({ reasonCode: "MANUAL", remark: "" });
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const dirty = reasonCode !== init.reasonCode || remark !== init.remark;

  const loadDetail = useCallback(async () => {
    try {
      const body = await apiFetch<AdjustmentDetail>(`/api/inventory-adjustments/${id}`);
      setDetail(body.data);
      setReasonCode(body.data.reasonCode);
      setRemark(body.data.remark ?? "");
      setInit({ reasonCode: body.data.reasonCode, remark: body.data.remark ?? "" });
      if (body.data.status !== "DRAFT") setNotEditable(true);
    } catch (err: unknown) {
      setError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "加载失败", "NETWORK_ERROR"),
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const save = async () => {
    if (!detail || submitting) return;
    const changes: Record<string, unknown> = {};
    if (reasonCode !== init.reasonCode) changes.reasonCode = reasonCode;
    if (remark !== init.remark) changes.remark = remark.trim() === "" ? null : remark;
    if (Object.keys(changes).length === 0) {
      setFieldErrors({ scope: "头字段没有修改" });
      return;
    }
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      await apiFetch(`/api/inventory-adjustments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: detail.version, ...changes, changeReason: "编辑调整单头" }),
      });
      await loadDetail();
    } catch (err: unknown) {
      setError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "保存失败", "NETWORK_ERROR"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <AppPage>
        <div className="border-border bg-surface shadow-elevation-sm rounded-lg border p-6 text-sm text-ink-muted">
          加载中…
        </div>
      </AppPage>
    );
  }

  if (notEditable && detail) {
    return (
      <AppPage>
        <div className="border-border bg-surface shadow-elevation-sm overflow-hidden rounded-lg border">
          <div className="border-border flex items-center justify-between border-b px-4 py-4 md:px-6">
            <h1 className="text-ink-primary text-lg font-semibold md:text-xl">
              编辑库存调整 — {detail.adjustmentNo}
            </h1>
            <a
              href={`/inventory/adjustments/${id}`}
              className="border-border text-ink-secondary rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-canvas"
            >
              返回详情
            </a>
          </div>
          <div className="p-6">
            <p className="text-sm text-status-warning-text">仅草稿状态可编辑（当前 {detail.status}）。</p>
          </div>
        </div>
      </AppPage>
    );
  }

  return (
    <EntityFormWorkspace
      title={`编辑库存调整 — ${detail?.adjustmentNo ?? ""}`}
      description={`当前状态：${STATUS_LABELS[detail?.status ?? ""] ?? detail?.status ?? ""}；仅 DRAFT 可编辑头字段。`}
      backHref={`/inventory/adjustments/${id}`}
      mode="edit"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onReload={() => {
        setError(null);
        setNotEditable(false);
        void loadDetail();
      }}
      onSave={save}
      onCancel={() => router.push(`/inventory/adjustments/${id}`)}
      saveLabel="保存头字段"
    >
      {fieldErrors.scope ? (
        <div className="rounded-md border border-status-warning-border bg-status-warning-bg p-3 text-sm text-status-warning-text">
          {fieldErrors.scope}
        </div>
      ) : null}
      <section className="rounded-md border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-primary">调整信息</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="原因码" required>
            <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} className={INPUT_CLASS}>
              {REASON_CODES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </FormField>
          <FormField label="备注（可选，≤500）">
            <input
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
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
    <PermissionGuard permission={actionPermission("inventory-adjustment", "edit")}>
      <AppPage>
        <AdjustmentEditForm />
      </AppPage>
    </PermissionGuard>
  );
}
