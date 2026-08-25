"use client";

/**
 * Inspections — 编辑质检记录（F2-3 Batch C1 Consolidation，CTO #11888 / FE 2.0 ui-08）
 *
 * 由旧式 CARD_CLASS 自绘表单迁移至统一 Workspace：
 * AppPage → EntityFormWorkspace → FormField。
 * - GET detail authoritative version；仅 PENDING 可编辑（非 PENDING 显示「当前状态不可编辑」+ 返回详情）
 * - PATCH 携带 version；inspectionMode 必填、remark 可选
 * - VERSION_CONFLICT 走 F2-2 统一 stale 面板（EntityFormWorkspace onReload：重新 GET → 更新 version → 成功后重置 dirty）
 * - 禁止 silent retry / 自动覆盖 / 自动重新 PATCH
 * - Dirty State 交 EntityFormWorkspace（不页面自挂 beforeunload / window.confirm）
 */
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import {
  AppPage,
  EntityFormWorkspace,
  ErrorPanel,
} from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";

interface InspectionDetail {
  id: string;
  inspectionMode: string;
  result: string;
  qualifiedQty: string;
  rejectedQty: string;
  remark?: string | null;
  version: number;
  purchaseReceiptLine?: {
    lineNo: number;
    quantity: string;
    rejectedOnReceiptQty: string;
    purchaseReceipt?: { code: string | null; status: string | null } | null;
    item?: { code: string | null; name: string | null } | null;
    uom?: { symbol: string | null } | null;
  } | null;
}

const MODE_OPTIONS = ["SKIP", "SPOT", "FULL"] as const;

const inputClass = INPUT_CLASS;


function InspectionEditForm() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();

  const [detail, setDetail] = useState<InspectionDetail | null>(null);
  const [notEditable, setNotEditable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);

  const [inspectionMode, setInspectionMode] = useState("SKIP");
  const [remark, setRemark] = useState("");
  const [version, setVersion] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // 加载详情（Edit 回填 + version CAS 源）
  const loadDetail = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    apiFetch<InspectionDetail>(`/api/inspections/${id}`, { signal: controller.signal })
      .then((body) => {
        const d = body.data;
        setDetail(d);
        if (d.result !== "PENDING") {
          setNotEditable(true);
          setLoading(false);
          return;
        }
        setNotEditable(false);
        setVersion(d.version);
        setInspectionMode(d.inspectionMode);
        setRemark(d.remark ?? "");
        // 重新加载最新数据后：重置 dirty（reload 成功才清）
        setDirty(false);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载失败", "NETWORK_ERROR"));
        setLoading(false);
      });
    return () => controller.abort();
  }, [id]);

  useEffect(() => loadDetail(), [loadDetail]);

  // F2-2 UX Hardening ②：409 VERSION_CONFLICT 后重新加载最新数据（保持 dirty=true 直到 GET 成功）
  const handleReload = () => {
    setError(null);
    setReloadKey((k) => k + 1);
  };

  useEffect(() => {
    if (reloadKey === 0) return;
    return loadDetail();
  }, [reloadKey, loadDetail]);

  // 三层 validation（仅 UX 层；领域事实以服务端为准）
  const validate = (): string | null => {
    if (!inspectionMode) return "请选择质检模式";
    return null;
  };

  const handleSave = () => {
    if (submitting) return;
    const firstError = validate();
    if (firstError) {
      setError(new ApiClientError(400, firstError, "VALIDATION"));
      return;
    }
    setSubmitting(true);
    setError(null);
    apiFetch<InspectionDetail>(`/api/inspections/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version,
        inspectionMode,
        ...(remark ? { remark } : {}),
      }),
    })
      .then(() => {
        setDirty(false);
        router.push(`/purchasing/inspections/${id}`);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "保存失败", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  if (loading) {
    return (
      <AppPage>
        <div className="border-border bg-surface rounded-lg border p-6 text-sm text-ink-muted">
          加载中…
        </div>
      </AppPage>
    );
  }

  if (loadError) {
    return (
      <AppPage>
        <ErrorPanel error={loadError} />
      </AppPage>
    );
  }

  if (notEditable || !detail) {
    return (
      <AppPage>
        <div className="border-border bg-surface rounded-lg border p-6">
          <p className="text-ink-primary text-sm font-medium">当前状态不可编辑</p>
          <p className="text-ink-secondary mt-1 text-sm">
            仅待检状态可编辑（当前状态：{detail?.result ?? "—"}）——质检结果已定稿，不可修改。
          </p>
          <button
            type="button"
            onClick={() => router.push(`/purchasing/inspections/${id}`)}
            className="bg-brand-600 hover:bg-brand-700 mt-3 rounded-md px-3 py-1.5 text-sm font-medium text-white"
          >
            返回详情
          </button>
        </div>
      </AppPage>
    );
  }

  const src = detail.purchaseReceiptLine;

  return (
    <AppPage>
      <EntityFormWorkspace
        title="编辑质检记录"
        description={`来源收货行：${src?.purchaseReceipt?.code ?? "—"} / L${src?.lineNo ?? "—"}`}
        backHref={`/purchasing/inspections/${id}`}
        mode="edit"
        submitting={submitting}
        error={error}
        dirty={dirty}
        onDirty={() => setDirty(true)}
        onReload={handleReload}
        onSave={handleSave}
        onCancel={() => router.push(`/purchasing/inspections/${id}`)}
      >
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">来源收货行</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <p className="text-ink-muted text-xs">来源收货单</p>
              <p className="text-ink-primary mt-0.5 text-sm">{src?.purchaseReceipt?.code ?? "—"}</p>
            </div>
            <div>
              <p className="text-ink-muted text-xs">物料</p>
              <p className="text-ink-primary mt-0.5 text-sm">
                {src?.item ? `${src.item.code ?? ""} ${src.item.name ?? ""}`.trim() : "—"}
              </p>
            </div>
            <div>
              <p className="text-ink-muted text-xs">到货数量</p>
              <p className="text-ink-primary mt-0.5 text-sm">
                {src?.quantity ?? "—"}
                {src?.uom?.symbol ? ` ${src.uom.symbol}` : ""}
              </p>
            </div>
            <div>
              <p className="text-ink-muted text-xs">现场拒收</p>
              <p className="text-ink-primary mt-0.5 text-sm">{src?.rejectedOnReceiptQty ?? "0"}</p>
            </div>
          </div>
        </section>

        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">基本信息</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField label="质检模式" required>
              <select
                value={inspectionMode}
                onChange={(e) => {
                  setInspectionMode(e.target.value);
                  setDirty(true);
                }}
                className={inputClass}
              >
                {MODE_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="备注">
              <textarea
                value={remark}
                onChange={(e) => {
                  setRemark(e.target.value);
                  setDirty(true);
                }}
                rows={2}
                maxLength={500}
                className={inputClass}
              />
            </FormField>
          </div>
        </section>
      </EntityFormWorkspace>
    </AppPage>
  );
}

export default function Page() {
  const { state } = useSession();
  const canEdit =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("inspection", "edit"));
  return (
    <PermissionGuard permission={PERMISSIONS.INSPECTION_READ}>
      {canEdit ? (
        <InspectionEditForm />
      ) : (
        <AppPage>
          <div className="border-border bg-surface rounded-lg border p-6 text-sm text-ink-secondary">
            无编辑权限
          </div>
        </AppPage>
      )}
    </PermissionGuard>
  );
}
