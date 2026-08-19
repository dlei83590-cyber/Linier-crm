"use client";

/**
 * Warehouse Receipt — 编辑仓库收货/入库（F2-3 Batch B2，CTO #11817）
 *
 * Edit 纪律（沿用 Batch A/B1 模式）：
 * - GET authoritative version；仅 DRAFT 可编辑（非 DRAFT 显示「当前状态不可编辑」+ 返回详情）
 * - 每行保留两个 immutable source identities：purchaseReceiptLineId + inspectionId（PATCH 原样回传）
 * - 换 Inspection 只能从「属于同一收货行且 backend contract 合法」的候选中选，不得跨行
 * - warehouse → location dependent selector（warehouseId 改变 → 清空 locationId → 重新加载 locations）
 * - serialNos 数组事实：文本输入但提交前 split/trim/dedupe
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

interface LocationOption {
  id: string;
  code: string;
  name: string;
}

interface InspectionOption {
  id: string;
  inspectionMode?: string | null;
  result?: string | null;
  qualifiedQty?: string | null;
}

interface WhrDetail {
  id: string;
  code: string;
  status: string;
  remark?: string | null;
  version: number;
  warehouseId?: string | null;
  locationId?: string | null;
  purchaseReceipt?: { code: string | null; status: string | null } | null;
  warehouse?: { id: string; code: string | null; name: string | null } | null;
  location?: { id: string; code: string | null; name: string | null } | null;
  lines?: Array<{
    id: string;
    lineNo: number;
    quantity: string;
    batchNo?: string | null;
    serialNos?: string[] | null;
    mfgDate?: string | null;
    expDate?: string | null;
    item?: { code: string | null; name: string | null } | null;
    uom?: { symbol: string | null } | null;
    purchaseReceiptLine?: {
      id: string;
      lineNo: number;
      purchaseOrderLine?: { id: string; lineNo: number; fulfillmentType: string } | null;
    } | null;
    inspection?: { id: string; inspectionMode: string | null; result: string | null; qualifiedQty: string | null } | null;
  }>;
}

interface WhrEditLineRow extends LineRow {
  /** 来源 identity ①：收货行 id（原样回传，不可编辑） */
  purchaseReceiptLineId: string;
  /** 来源 identity ②：质检结论 id（属于同一收货行，原样回传） */
  inspectionId: string;
  lineLabel: string;
  quantity: string;
  batchNo: string;
  serialNos: string;
  mfgDate: string;
  expDate: string;
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

function WhrEditForm() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();

  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [warehousesLoading, setWarehousesLoading] = useState(true);
  // 每个收货行 → 合法 Inspection 候选（属于该行且已完成 + qualifiedQty>0）
  const [inspectionMap, setInspectionMap] = useState<Record<string, InspectionOption[]>>({});

  const [detail, setDetail] = useState<WhrDetail | null>(null);
  const [notEditable, setNotEditable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);

  const [warehouseId, setWarehouseId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [remark, setRemark] = useState("");
  const [lines, setLines] = useState<WhrEditLineRow[]>([]);
  const [version, setVersion] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // 加载某收货行的合法 Inspections（已验收且 qualifiedQty>0 的可入库候选）
  const loadInspections = useCallback((receiptLineId: string) => {
    const controller = new AbortController();
    apiFetch<InspectionOption[]>(
      `/api/inspections?purchaseReceiptLineId=${encodeURIComponent(receiptLineId)}&pageSize=100`,
      { signal: controller.signal },
    )
      .then((body) => {
        const list = body.data ?? [];
        const usable = list.filter(
          (i) => i.result !== "PENDING" && Number(i.qualifiedQty ?? 0) > 0,
        );
        setInspectionMap((prev) => ({ ...prev, [receiptLineId]: usable }));
      })
      .catch(() => {
        setInspectionMap((prev) => ({ ...prev, [receiptLineId]: [] }));
      });
    return () => controller.abort();
  }, []);

  const loadDetail = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    apiFetch<WhrDetail>(`/api/warehouse-receipts/${id}`, { signal: controller.signal })
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
        setLocationId(d.locationId ?? "");
        setRemark(d.remark ?? "");
        const rows: WhrEditLineRow[] = (d.lines ?? []).map((l) => ({
          id: l.id,
          // 保留两个 source identities：PATCH 原样回传
          purchaseReceiptLineId: l.purchaseReceiptLine?.id ?? "",
          inspectionId: l.inspection?.id ?? "",
          lineLabel: `L${l.lineNo} ${l.item?.code ?? ""} ${l.item?.name ?? ""} (${l.uom?.symbol ?? ""})`.trim(),
          quantity: l.quantity ?? "",
          batchNo: l.batchNo ?? "",
          serialNos: (l.serialNos ?? []).join(", "),
          mfgDate: l.mfgDate ?? "",
          expDate: l.expDate ?? "",
        }));
        setLines(rows);
        // 逐行加载合法 Inspection 候选（供换选，仍限同一收货行）
        for (const l of d.lines ?? []) {
          if (l.purchaseReceiptLine?.id) loadInspections(l.purchaseReceiptLine.id);
        }
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
  }, [id, loadInspections]);

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

  // warehouse → location dependent selector：warehouseId 改变 → 清空 locationId → 重新加载 locations
  const handleWarehouseChange = (wid: string) => {
    setWarehouseId(wid);
    setLocationId("");
    setLocations([]);
    if (!wid) return;
    const controller = new AbortController();
    apiFetch<LocationOption[]>(
      `/api/warehouse-locations?warehouseId=${encodeURIComponent(wid)}&pageSize=100`,
      { signal: controller.signal },
    )
      .then((body) => setLocations(body.data))
      .catch(() => setLocations([]));
    setDirty(true);
  };

  const updateLine = (idx: number, patch: Partial<WhrEditLineRow>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    setDirty(true);
  };

  // 三层 validation（仅 UX 层；领域事实以服务端为准）
  const validate = (): string | null => {
    if (!warehouseId) return "请选择仓库";
    if (lines.length === 0) return "至少需要一行入库明细";
    for (let i = 0; i < lines.length; i += 1) {
      const l = lines[i];
      if (!l.inspectionId) return `第 ${i + 1} 行：请选择质检结论`;
      const qty = Number(l.quantity);
      if (!l.quantity || !Number.isFinite(qty) || qty <= 0) {
        return `第 ${i + 1} 行：入库数量必须 > 0`;
      }
      const usable = inspectionMap[l.purchaseReceiptLineId] ?? [];
      const chosen = usable.find((ins) => ins.id === l.inspectionId);
      const maxQty = Number(chosen?.qualifiedQty ?? 0);
      if (chosen && qty > maxQty) {
        return `第 ${i + 1} 行：入库数量不能超过质检合格量（${maxQty}）`;
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
    apiFetch<{ id: string }>(`/api/warehouse-receipts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        version,
        warehouseId,
        ...(locationId ? { locationId } : { locationId: null }),
        ...(remark.trim() ? { remark: remark.trim() } : { remark: null }),
        lines: lines.map((l) => ({
          // source identities 原样回传（backend 校验属于同一收货行 + 合法 Inspection）
          purchaseReceiptLineId: l.purchaseReceiptLineId,
          inspectionId: l.inspectionId,
          quantity: Number(l.quantity),
          ...(l.batchNo.trim() ? { batchNo: l.batchNo.trim() } : {}),
          ...(l.serialNos.trim()
            ? {
                serialNos: [...new Set(l.serialNos.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean))],
              }
            : {}),
          ...(l.mfgDate ? { mfgDate: l.mfgDate } : {}),
          ...(l.expDate ? { expDate: l.expDate } : {}),
        })),
      }),
    })
      .then(() => router.push(`/purchasing/warehouse-receipts/${id}`))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  const lineColumns: LineColumn<WhrEditLineRow>[] = [
    { key: "lineLabel", header: "来源行（收货）", type: "readonly" },
    {
      key: "inspectionId",
      header: "质检结论 *",
      type: "select",
      options: [],
      placeholder: "请选择",
      // select options 需按行动态（属于该收货行的合法 Inspection）→ 用 render 定制
      render: (row) => {
        const usable = inspectionMap[row.purchaseReceiptLineId] ?? [];
        return (
          <select
            value={row.inspectionId}
            onChange={(e) => updateLine(lines.findIndex((l) => l.id === row.id), { inspectionId: e.target.value })}
            className="w-full rounded-md border border-border px-3 py-1 text-sm focus:border-brand-500 focus:outline-none"
          >
            <option value="">请选择质检结论</option>
            {usable.map((ins) => (
              <option key={ins.id} value={ins.id}>
                {ins.inspectionMode ?? ins.result ?? ins.id}
                {`（合格 ${ins.qualifiedQty ?? 0}）`}
              </option>
            ))}
          </select>
        );
      },
    },
    { key: "quantity", header: "入库数量 *", type: "number", placeholder: "≤ 合格量" },
    { key: "batchNo", header: "批次号", type: "text", placeholder: "可选" },
    { key: "serialNos", header: "序列号（逗号分隔）", type: "text", placeholder: "可选" },
    { key: "mfgDate", header: "生产日期", type: "text", placeholder: "YYYY-MM-DD" },
    { key: "expDate", header: "有效期至", type: "text", placeholder: "YYYY-MM-DD" },
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
            onClick={() => router.push(`/purchasing/warehouse-receipts/${id}`)}
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
        title={`编辑仓库收货 — ${detail.code}`}
        description={`来源收货单：${detail.purchaseReceipt?.code ?? "—"}（承诺事实锁定，不可更换）`}
        backHref={`/purchasing/warehouse-receipts/${id}`}
        mode="edit"
        submitting={submitting}
        error={error}
        dirty={dirty}
        onDirty={() => setDirty(true)}
        onReload={handleReload}
        onSave={handleSave}
        onCancel={() => router.push(`/purchasing/warehouse-receipts/${id}`)}
      >
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">基本信息</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="仓库" required>
              <ReferenceSelector
                value={warehouseId}
                onChange={handleWarehouseChange}
                options={warehouses.map((w) => ({ value: w.id, label: w.name, hint: w.code }))}
                placeholder="请选择仓库"
                loading={warehousesLoading}
              />
            </Field>
            <Field label="库位（属于所选仓库）">
              <ReferenceSelector
                value={locationId}
                onChange={(v) => {
                  setLocationId(v);
                  setDirty(true);
                }}
                options={locations.map((loc) => ({ value: loc.id, label: loc.name, hint: loc.code }))}
                placeholder="可选（随仓库变化）"
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

        <LineEditor<WhrEditLineRow>
          columns={lineColumns}
          lines={lines}
          onChange={(next) => {
            setLines(next);
            setDirty(true);
          }}
          onAdd={() => ({
            id: crypto.randomUUID(),
            purchaseReceiptLineId: "",
            inspectionId: "",
            lineLabel: "",
            quantity: "",
            batchNo: "",
            serialNos: "",
            mfgDate: "",
            expDate: "",
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
    hasPermission(state.user.roles as RoleCode[], actionPermission("warehouse-receipt", "edit"));
  return (
    <PermissionGuard permission={PERMISSIONS.WAREHOUSE_RECEIPT_READ}>
      {canEdit ? (
        <WhrEditForm />
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
