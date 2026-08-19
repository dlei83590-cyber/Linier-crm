"use client";

/**
 * Purchase Receipt — 编辑到货收货（F2-3 Batch B1，CTO #11817）
 *
 * Edit 纪律（沿用 Batch A 模式）：
 * - GET authoritative version；仅 DRAFT 可编辑（非 DRAFT 显示「当前状态不可编辑」+ 返回详情）
 * - 每行保留 purchaseOrderLine.id（source identity）；PATCH lines 全量替换原样回传 purchaseOrderLineId
 * - 来源 PO 是承诺事实：Edit 不提供换 PO（只读展示 PO code）
 * - warehouse 可按 backend contract 在 DRAFT 修改（WAREHOUSE 行需 warehouse，backend 兜底）
 * - VERSION_CONFLICT 走 F2-2 统一 stale 面板（onReload：保持 dirty → 重新 GET → 成功才清）；禁止 silent retry
 * - dirty 交 EntityFormWorkspace；权限 shared constants
 */
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import {
  AppPage,
  EntityFormWorkspace,
  ReferenceSelector,
  LineEditor,
  ErrorPanel,
  type LineColumn,
  type LineRow,
} from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { INPUT_CLASS } from "@/lib/ui-classes";

interface WarehouseOption {
  id: string;
  code: string;
  name: string;
}

interface ReceiptDetail {
  id: string;
  code: string;
  status: string;
  remark?: string | null;
  version: number;
  warehouseId?: string | null;
  purchaseOrder?: { code: string | null; status: string | null } | null;
  supplier?: { name: string | null } | null;
  lines?: Array<{
    id: string;
    lineNo: number;
    quantity: string;
    visibleDamageQty?: string | null;
    rejectedOnReceiptQty?: string | null;
    item?: { code: string | null; name: string | null } | null;
    uom?: { symbol: string | null } | null;
    purchaseOrderLine?: {
      id: string;
      lineNo: number;
      quantity: string;
      receivedQty: string;
      remainingReceiveQty: string;
      fulfillmentType: string;
    } | null;
  }>;
}

interface ReceiptEditLineRow extends LineRow {
  /** 来源 identity：PO Line id（原样回传，不可编辑） */
  purchaseOrderLineId: string;
  lineLabel: string;
  quantity: string;
  visibleDamageQty: string;
  rejectedOnReceiptQty: string;
}

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

function ReceiptEditForm() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();

  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [warehousesLoading, setWarehousesLoading] = useState(true);

  const [detail, setDetail] = useState<ReceiptDetail | null>(null);
  const [notEditable, setNotEditable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);

  const [warehouseId, setWarehouseId] = useState("");
  const [remark, setRemark] = useState("");
  const [lines, setLines] = useState<ReceiptEditLineRow[]>([]);
  const [version, setVersion] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const loadDetail = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    apiFetch<ReceiptDetail>(`/api/purchase-receipts/${id}`, { signal: controller.signal })
      .then((body) => {
        const d = body.data;
        setDetail(d);
        if (d.status !== "DRAFT") {
          setNotEditable(true);
          setLoading(false);
          return;
        }
        setNotEditable(false);
        setVersion(d.version);
        setWarehouseId(d.warehouseId ?? "");
        setRemark(d.remark ?? "");
        setLines(
          (d.lines ?? []).map((l) => ({
            id: l.id,
            // 保留 source identity：PATCH 原样回传 purchaseOrderLineId
            purchaseOrderLineId: l.purchaseOrderLine?.id ?? "",
            lineLabel: `L${l.lineNo} ${l.item?.code ?? ""} ${l.item?.name ?? ""} (${l.uom?.symbol ?? ""})`.trim(),
            quantity: l.quantity ?? "",
            visibleDamageQty: l.visibleDamageQty ?? "0",
            rejectedOnReceiptQty: l.rejectedOnReceiptQty ?? "0",
          })),
        );
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

  // 数据源：warehouses（当前 main FINAL read API）
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<WarehouseOption[]>("/api/warehouses?pageSize=100", { signal: controller.signal })
      .then((body) => {
        setWarehouses(body.data);
        setWarehousesLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载数据源失败", "NETWORK_ERROR"));
        setWarehousesLoading(false);
      });
    return () => controller.abort();
  }, []);

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
    if (lines.length === 0) return "至少需要一行收货明细";
    for (let i = 0; i < lines.length; i += 1) {
      const l = lines[i];
      const qty = Number(l.quantity);
      if (!l.quantity || !Number.isFinite(qty) || qty <= 0) {
        return `第 ${i + 1} 行：收货数量必须 > 0`;
      }
      const rejected = Number(l.rejectedOnReceiptQty || 0);
      if (!Number.isFinite(rejected) || rejected < 0 || rejected > qty) {
        return `第 ${i + 1} 行：现场拒收数量不能超过收货数量`;
      }
      const visible = Number(l.visibleDamageQty || 0);
      if (!Number.isFinite(visible) || visible < 0) {
        return `第 ${i + 1} 行：可见损坏数量不能为负`;
      }
    }
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
    apiFetch<{ id: string }>(`/api/purchase-receipts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        version,
        ...(warehouseId ? { warehouseId } : { warehouseId: null }),
        ...(remark.trim() ? { remark: remark.trim() } : { remark: null }),
        lines: lines.map((l) => ({
          // source identity 原样回传（backend 校验属于同一 PO）
          purchaseOrderLineId: l.purchaseOrderLineId,
          quantity: Number(l.quantity),
          visibleDamageQty: Number(l.visibleDamageQty || 0),
          rejectedOnReceiptQty: Number(l.rejectedOnReceiptQty || 0),
        })),
      }),
    })
      .then(() => router.push(`/purchasing/receipts/${id}`))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  const lineColumns: LineColumn<ReceiptEditLineRow>[] = [
    { key: "lineLabel", header: "来源行（PO）", type: "readonly" },
    { key: "quantity", header: "收货数量 *", type: "number", placeholder: "> 0" },
    { key: "visibleDamageQty", header: "可见损坏", type: "number", placeholder: "0" },
    { key: "rejectedOnReceiptQty", header: "现场拒收", type: "number", placeholder: "0" },
  ];

  if (loading) {
    return (
      <AppPage>
        <div className="border-border bg-surface rounded-lg border p-6 text-sm text-ink-muted">加载中…</div>
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
          <p className="text-sm font-medium text-ink-primary">当前状态不可编辑</p>
          <p className="mt-1 text-sm text-ink-secondary">
            仅 DRAFT 状态可编辑（当前状态：{detail?.status ?? "—"}）
          </p>
          <button
            type="button"
            onClick={() => router.push(`/purchasing/receipts/${id}`)}
            className="bg-brand-600 hover:bg-brand-700 mt-3 rounded-md px-3 py-1.5 text-sm font-medium text-white"
          >
            返回详情
          </button>
        </div>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <EntityFormWorkspace
        title={`编辑到货收货 — ${detail.code}`}
        description={`来源采购订单：${detail.purchaseOrder?.code ?? "—"}（承诺事实锁定，不可更换）`}
        backHref={`/purchasing/receipts/${id}`}
        mode="edit"
        submitting={submitting}
        error={error}
        dirty={dirty}
        onDirty={() => setDirty(true)}
        onReload={handleReload}
        onSave={handleSave}
        onCancel={() => router.push(`/purchasing/receipts/${id}`)}
      >
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">基本信息</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="仓库（公司仓库到货）">
              <ReferenceSelector
                value={warehouseId}
                onChange={(v) => {
                  setWarehouseId(v);
                  setDirty(true);
                }}
                options={warehouses.map((w) => ({ value: w.id, label: w.name, hint: w.code }))}
                placeholder="可选（DIRECT_PROJECT 不要求）"
                loading={warehousesLoading}
              />
            </Field>
            <Field label="备注">
              <textarea
                value={remark}
                onChange={(e) => {
                  setRemark(e.target.value);
                  setDirty(true);
                }}
                rows={2}
                className={inputClass}
              />
            </Field>
          </div>
        </section>

        <LineEditor<ReceiptEditLineRow>
          columns={lineColumns}
          lines={lines}
          onChange={(next) => {
            setLines(next);
            setDirty(true);
          }}
          onAdd={() => ({
            id: crypto.randomUUID(),
            purchaseOrderLineId: "",
            lineLabel: "",
            quantity: "",
            visibleDamageQty: "0",
            rejectedOnReceiptQty: "0",
          })}
          addLabel="添加行"
          disableAdd
        />
      </EntityFormWorkspace>
    </AppPage>
  );
}

export default function Page() {
  const { state } = useSession();
  const canEdit =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("purchase-receipt", "edit"));
  return (
    <PermissionGuard permission={PERMISSIONS.PURCHASE_RECEIPT_READ}>
      {canEdit ? (
        <ReceiptEditForm />
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
