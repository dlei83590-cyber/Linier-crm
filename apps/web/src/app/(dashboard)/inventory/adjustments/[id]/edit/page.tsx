"use client";

/**
 * Inventory Adjustment Edit — 编辑库存调整单（F2-6B 批 3，头字段）
 *
 * 契约：PATCH /api/inventory-adjustments/:id，仅 DRAFT，乐观锁 version CAS。
 * 可编辑：reasonCode / remark（行整体替换本轮不做，创建后行如需调整请取消后新建）。
 * PermissionGuard 对齐 API requirePermission("inventory-adjustment:edit")。
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { CARD_CLASS } from "@/lib/ui-classes";

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

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

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
    return <div className="rounded-lg border border-border bg-surface p-6 text-sm text-ink-muted">加载中…</div>;
  }

  if (error && !detail) {
    return (
      <div className="rounded-lg border border-status-danger-border bg-status-danger-bg p-6 text-sm text-status-danger-text">
        {describeStatus(error.status)}：{error.message}
        <div className="mt-3">
          <Link href={`/inventory/adjustments/${id}`} className="text-brand-600 hover:underline">返回详情</Link>
        </div>
      </div>
    );
  }

  if (notEditable && detail) {
    return (
      <div className={CARD_CLASS}>
        <div className="flex items-center justify-between border-b border-border p-4">
          <h1 className="text-lg font-semibold text-ink-primary">编辑库存调整 — {detail.adjustmentNo}</h1>
          <Link href={`/inventory/adjustments/${id}`} className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-canvas">返回详情</Link>
        </div>
        <div className="p-6">
          <p className="text-sm text-status-warning-text">仅草稿状态可编辑（当前 {detail.status}）。</p>
        </div>
      </div>
    );
  }

  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center justify-between border-b border-border p-4">
        <h1 className="text-lg font-semibold text-ink-primary">
          编辑库存调整 — {detail?.adjustmentNo}
          <span className="ml-2 text-xs font-normal text-ink-muted">{detail?.status}（v{detail?.version}）</span>
        </h1>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-status-warning-text">有未保存的更改</span>}
          <Link
            href={`/inventory/adjustments/${id}`}
            onClick={(e) => {
              if (dirty && !window.confirm("有未保存的更改，确定离开？")) e.preventDefault();
            }}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-canvas"
          >
            返回详情
          </Link>
        </div>
      </div>

      <div className="p-4">
        {error && (
          <div className="mb-4 rounded-md bg-status-danger-bg p-3 text-sm text-status-danger-text">
            <p>
              {describeStatus(error.status)}：{error.message}
              {error.code ? `（${error.code}）` : ""}
            </p>
            {error.code === "VERSION_CONFLICT" && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("未保存的更改将丢失，确定重新载入最新数据？")) {
                    setError(null);
                    setNotEditable(false);
                    loadDetail();
                  }
                }}
                className="bg-brand-600 hover:bg-brand-700 mt-2 rounded-md px-3 py-1 text-xs font-medium text-white"
              >
                重新载入最新数据
              </button>
            )}
          </div>
        )}
        {fieldErrors.scope && (
          <div className="mb-4 rounded-md border border-status-warning-border bg-status-warning-bg p-3 text-sm text-status-warning-text">{fieldErrors.scope}</div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-4 rounded-md bg-canvas p-4 text-sm md:grid-cols-2">
          <div>
            <label className="block text-xs text-ink-secondary">原因码</label>
            <select
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
            >
              {REASON_CODES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">备注（可选，≤500）</label>
            <input
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              maxLength={500}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={submitting}
            className="bg-brand-600 hover:bg-brand-700 rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "保存中…" : "保存头字段"}
          </button>
          {dirty && <span className="text-xs text-status-warning-text">有未保存的更改</span>}
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("inventory-adjustment", "edit")}>
      <AdjustmentEditForm />
    </PermissionGuard>
  );
}