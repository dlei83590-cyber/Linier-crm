"use client";

/**
 * Inspections — 新建质检记录（F2-3 Batch C1 Consolidation，CTO #11888 / FE 2.0 ui-08）
 *
 * 由旧式 CARD_CLASS 自绘表单迁移至统一 Workspace：
 * AppPage → EntityFormWorkspace → FormField → ReferenceSelector。
 * - 数据源：收货单列表（GET /api/purchase-receipts FINAL read API）+ 详情行（GET /api/purchase-receipts/{id}）
 * - 选择收货单 → 拉取该单来源行；purchaseReceiptLineId 必填；inspectionMode 必填（SKIP/SPOT/FULL）
 * - 服务端生成 canonical id 后导航；Dirty State 交 EntityFormWorkspace（不页面自挂 beforeunload / window.confirm）
 * - 权限用 shared constant（PERMISSIONS / actionPermission），不复制裸字符串
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import {
  AppPage,
  EntityFormWorkspace,
  ReferenceSelector,
} from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";

interface ReceiptRow {
  id: string;
  code: string | null;
  status: string | null;
  purchaseOrder?: { code: string | null } | null;
}

interface ReceiptLineOption {
  id: string;
  lineNo: number;
  quantity: string;
  item?: { code: string | null; name: string | null } | null;
  uom?: { symbol: string | null } | null;
}

interface ReceiptDetail {
  id: string;
  code: string | null;
  status: string | null;
  lines?: ReceiptLineOption[];
}

const MODE_OPTIONS = ["SKIP", "SPOT", "FULL"] as const;

const inputClass = INPUT_CLASS;


function InspectionCreateForm() {
  const router = useRouter();

  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [lines, setLines] = useState<ReceiptLineOption[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [receiptId, setReceiptId] = useState("");
  const [purchaseReceiptLineId, setPurchaseReceiptLineId] = useState("");
  const [inspectionMode, setInspectionMode] = useState("SKIP");
  const [remark, setRemark] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  // 数据源：已收货单列表（GET /api/purchase-receipts FINAL read API）
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<ReceiptRow[] | { total: number; page: number; pageSize: number; items: ReceiptRow[] }>(
      "/api/purchase-receipts?pageSize=100",
      { signal: controller.signal },
    )
      .then((body) => setReceipts(Array.isArray(body.data) ? body.data : (body.data.items ?? [])))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载收货单失败", "NETWORK_ERROR"));
      });
    return () => controller.abort();
  }, []);

  const loadReceiptLines = (receiptId: string) => {
    setReceiptId(receiptId);
    setLines([]);
    setPurchaseReceiptLineId("");
    if (!receiptId) return;
    setLinesLoading(true);
    apiFetch<ReceiptDetail>(`/api/purchase-receipts/${receiptId}`)
      .then((body) => setLines(body.data.lines ?? []))
      .catch((err: unknown) => {
        if (err instanceof ApiClientError) {
          setError(err);
        }
      })
      .finally(() => setLinesLoading(false));
  };

  // 三层 validation（仅 UX 层；领域事实以服务端为准）
  const validate = (): string | null => {
    if (!purchaseReceiptLineId) return "请选择来源收货行";
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
    apiFetch<{ id: string }>("/api/inspections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        purchaseReceiptLineId,
        inspectionMode,
        ...(remark ? { remark } : {}),
      }),
    })
      .then((body) => {
        setDirty(false);
        router.push(`/purchasing/inspections/${body.data.id}`);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "创建失败", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  return (
    <EntityFormWorkspace
      title="新建质检记录"
      description="创建质检记录（PENDING）"
      backHref="/purchasing/inspections"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSave}
      onCancel={() => router.push("/purchasing/inspections")}
      saveLabel="创建（PENDING）"
    >
      <section className="border-border rounded-md border p-4">
        <h2 className="text-ink-primary mb-3 text-sm font-semibold">基本信息</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="收货单（已 RECEIVED）">
            <ReferenceSelector
              value={receiptId}
              onChange={loadReceiptLines}
              options={receipts.map((r) => ({
                value: r.id,
                label: r.code ?? "—",
                hint: `${r.status ?? ""}${r.purchaseOrder?.code ? ` / PO ${r.purchaseOrder.code}` : ""}`.trim(),
              }))}
              placeholder="选择收货单"
            />
          </FormField>
          <FormField label="来源收货行" required>
            <ReferenceSelector
              value={purchaseReceiptLineId}
              onChange={(v) => {
                setPurchaseReceiptLineId(v);
                setDirty(true);
              }}
              options={lines.map((l) => ({
                value: l.id,
                label: `L${l.lineNo} ${l.item?.code ?? ""} ${l.item?.name ?? ""}`.trim(),
                hint: `数量 ${l.quantity}${l.uom?.symbol ? ` ${l.uom.symbol}` : ""}`.trim(),
              }))}
              placeholder="先选择收货单"
              disabled={!receiptId}
              loading={linesLoading}
            />
          </FormField>
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
  );
}

export default function Page() {
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("inspection", "create"));
  return (
    <PermissionGuard permission={PERMISSIONS.INSPECTION_READ}>
      {canCreate ? (
        <AppPage>
          <InspectionCreateForm />
        </AppPage>
      ) : (
        <AppPage>
          <div className="border-border bg-surface rounded-lg border p-6 text-sm text-ink-secondary">
            无创建权限
          </div>
        </AppPage>
      )}
    </PermissionGuard>
  );
}
