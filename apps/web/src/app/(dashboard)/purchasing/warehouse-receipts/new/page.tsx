"use client";

/**
 * Warehouse Receipt — 新建仓库收货/入库（F2-3 Batch B2，CTO #11817）
 *
 * 来源链纪律（backend Gate 兜底）：
 * - 选择 Purchase Receipt → GET /api/purchase-receipts/{id} → 只显示 WAREHOUSE 来源行（DIRECT_PROJECT 禁入库）
 * - 每行绑定两个 immutable source identities：purchaseReceiptLineId + inspectionId
 * - inspection 从「属于该 Receipt Line 且已完成 + qualifiedQty>0」的候选加载（/api/inspections?purchaseReceiptLineId=）
 * - warehouse → location dependent selector（warehouseId 改变 → 清空 locationId → 重新加载 locations）
 * - quantity ≤ Inspection 可入库余额（UX 层校验，backend 兜底）
 * - serialNos 文本输入但提交前 split/trim/dedupe 成数组；batchNo/mfgDate/expDate 结构化传递
 *
 * 页面消费 F2-2 Workspace：AppPage → EntityFormWorkspace → DependentSelector → LineEditor；
 * dirty 交 EntityFormWorkspace；权限 shared constants。
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import {
  AppPage,
  EntityFormWorkspace,
  ReferenceSelector,
  LineEditor,
  type LineColumn,
  type LineRow,
} from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { INPUT_CLASS } from "@/lib/ui-classes";

interface ReceiptOption {
  id: string;
  code: string;
  status: string;
}

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

interface ReceiptLineOption {
  id: string;
  lineNo: number;
  quantity: string;
  item?: { id: string; code: string | null; name: string | null } | null;
  uom?: { id: string; code: string | null; symbol: string | null } | null;
  purchaseOrderLine?: {
    id: string;
    lineNo: number;
    fulfillmentType: string;
  } | null;
}

interface WhrLineRow extends LineRow {
  /** 来源 identity ①：收货行 id（不可编辑） */
  purchaseReceiptLineId: string;
  /** 来源 identity ②：质检结论 id（必须属于该收货行，不可跨行） */
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

function WhrCreateForm() {
  const router = useRouter();

  const [receipts, setReceipts] = useState<ReceiptOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [selectorsLoading, setSelectorsLoading] = useState(true);
  // 每个收货行 → 合法 Inspection 候选（属于该行且已完成 + qualifiedQty>0）
  const [inspectionMap, setInspectionMap] = useState<Record<string, InspectionOption[]>>({});

  const [purchaseReceiptId, setPurchaseReceiptId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [remark, setRemark] = useState("");
  const [lines, setLines] = useState<WhrLineRow[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  // 数据源：RECEIVED 收货单（backend Gate 兜底）+ warehouses（当前 main FINAL read API）
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiFetch<ReceiptOption[]>("/api/purchase-receipts?pageSize=100", { signal: controller.signal }),
      apiFetch<WarehouseOption[]>("/api/warehouses?pageSize=100", { signal: controller.signal }),
    ])
      .then(([rcBody, whBody]) => {
        setReceipts(rcBody.data);
        setWarehouses(whBody.data);
        setSelectorsLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载数据源失败", "NETWORK_ERROR"));
        setSelectorsLoading(false);
      });
    return () => controller.abort();
  }, []);

  // 选择 Purchase Receipt → GET authoritative detail → 只显示 WAREHOUSE 来源行（DIRECT_PROJECT 禁入库）
  const handleReceiptChange = (receiptId: string) => {
    setPurchaseReceiptId(receiptId);
    setLines([]);
    setInspectionMap({});
    if (!receiptId) return;
    apiFetch<{ lines?: ReceiptLineOption[] }>(`/api/purchase-receipts/${receiptId}`)
      .then((body) => {
        const detailLines = (body.data.lines ?? []).filter(
          (l) => l.purchaseOrderLine?.fulfillmentType === "WAREHOUSE",
        );
        setLines(
          detailLines.map((l) => ({
            id: `${l.id}-whr-row`,
            purchaseReceiptLineId: l.id,
            inspectionId: "",
            lineLabel: `L${l.lineNo} ${l.item?.code ?? ""} ${l.item?.name ?? ""} (${l.uom?.symbol ?? ""})`.trim(),
            quantity: "",
            batchNo: "",
            serialNos: "",
            mfgDate: "",
            expDate: "",
          })),
        );
        // 逐行加载合法 Inspection 候选（属于该行且已完成 + qualifiedQty>0）
        for (const l of detailLines) {
          loadInspections(l.id);
        }
        setDirty(true);
      })
      .catch(() => {
        setLines([]);
      });
  };

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

  const updateLine = (idx: number, patch: Partial<WhrLineRow>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    setDirty(true);
  };

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

  // 三层 validation（仅 UX 层；领域事实以服务端为准）
  const validate = (): string | null => {
    if (!purchaseReceiptId) return "请选择来源收货单";
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
    apiFetch<{ id: string }>("/api/warehouse-receipts", {
      method: "POST",
      body: JSON.stringify({
        purchaseReceiptId,
        warehouseId,
        ...(locationId ? { locationId } : {}),
        ...(remark.trim() ? { remark: remark.trim() } : {}),
        lines: lines.map((l) => ({
          purchaseReceiptLineId: l.purchaseReceiptLineId,
          inspectionId: l.inspectionId,
          quantity: Number(l.quantity),
          ...(l.batchNo.trim() ? { batchNo: l.batchNo.trim() } : {}),
          // serialNos：文本输入 → split/trim/dedupe 成数组（结构化事实，不传未经校验的逗号字符串）
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
      .then((body) => router.push(`/purchasing/warehouse-receipts/${body.data.id}`))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  const lineColumns: LineColumn<WhrLineRow>[] = [
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
            onChange={(e) =>
              updateLine(lines.findIndex((l) => l.id === row.id), { inspectionId: e.target.value })
            }
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

  return (
    <EntityFormWorkspace
      title="新建仓库收货"
      description="创建仓库收货/入库单（DRAFT）"
      backHref="/purchasing/warehouse-receipts"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSave}
      onCancel={() => router.push("/purchasing/warehouse-receipts")}
    >
      <section className="border-border rounded-md border p-4">
        <h2 className="text-ink-primary mb-3 text-sm font-semibold">基本信息</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="来源收货单" required>
            <ReferenceSelector
              value={purchaseReceiptId}
              onChange={handleReceiptChange}
              options={receipts.map((r) => ({ value: r.id, label: r.code, hint: r.status }))}
              placeholder="请选择来源收货单（RECEIVED）"
              loading={selectorsLoading}
            />
          </Field>
          <Field label="仓库" required>
            <ReferenceSelector
              value={warehouseId}
              onChange={handleWarehouseChange}
              options={warehouses.map((w) => ({ value: w.id, label: w.name, hint: w.code }))}
              placeholder="请选择仓库"
              loading={selectorsLoading}
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
              loading={selectorsLoading}
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

      <LineEditor<WhrLineRow>
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
        emptyMessage="请先选择来源收货单（仅 WAREHOUSE 来源行可入库）"
      />
    </EntityFormWorkspace>
  );
}

export default function Page() {
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("warehouse-receipt", "create"));
  return (
    <PermissionGuard permission={PERMISSIONS.WAREHOUSE_RECEIPT_READ}>
      {canCreate ? (
        <AppPage>
          <WhrCreateForm />
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
