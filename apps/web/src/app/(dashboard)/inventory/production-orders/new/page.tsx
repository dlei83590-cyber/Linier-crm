"use client";

/**
 * ProductionOrder Create — 新建生产/外协工单（P-4 Item Sourcing，ADR-0049 + UI-09 FE2.0 表单统一）
 *
 * 契约：POST /api/production-orders（production-order:create），orderNo PRD 创建即取号。
 * - 有 BOM（ACTIVE）：服务端按配方计算领料量（需求 = 成品数 × 系数 × (1+损耗率)）——前端展示预估，提交后服务端权威重算
 * - 无 BOM（手工）：前端提供物料行（数量/单位/领料仓库）
 * - OEM 外协：必选外协厂（供应商）+ 加工费（计入成品成本）
 *
 * UI-09：迁移至 EntityFormWorkspace（Dirty-State Guard / 409 冲突面板 / ErrorPanel /
 * 统一 Save/Cancel），移除页面级 window.confirm；数字列右对齐 tabular-nums。
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { FormField } from "@/components/ui/form-field";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { INPUT_CLASS } from "@/lib/ui-classes";

interface ItemOption {
  id: string;
  code: string | null;
  name: string | null;
  stockUom?: { id: string; code: string | null; symbol: string | null } | null;
}
interface BomOption {
  id: string;
  bomNo: string;
  bomVersion: number;
  status: string;
}
interface BomDetail {
  id: string;
  bomNo: string;
  finishedItemId: string;
  lines?: Array<{
    componentItemId: string;
    componentUomId: string;
    qtyPerFinishedUnit: string;
    lossRate: string;
    componentItem?: { code: string | null; name: string | null } | null;
    componentUom?: { code: string | null; symbol: string | null } | null;
  }>;
}
interface WarehouseOption { id: string; code: string | null; name: string | null }
interface SupplierOption { id: string; code: string | null; name: string | null }
interface UomOption { id: string; code: string | null; symbol: string | null }

interface MaterialLineForm {
  key: string;
  itemId: string;
  quantity: string;
  uomId: string;
  warehouseId: string;
}

const inputClass = INPUT_CLASS;

const emptyMaterialLine = (): MaterialLineForm => ({
  key: crypto.randomUUID(),
  itemId: "",
  quantity: "",
  uomId: "",
  warehouseId: "",
});

function OrderCreateForm() {
  const router = useRouter();
  const [items, setItems] = useState<ItemOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [uoms, setUoms] = useState<UomOption[]>([]);
  const [boms, setBoms] = useState<BomOption[]>([]);
  const [bomDetail, setBomDetail] = useState<BomDetail | null>(null);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);

  const [productionType, setProductionType] = useState("SELF_MANUFACTURE");
  const [finishedItemId, setFinishedItemId] = useState("");
  const [plannedQty, setPlannedQty] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [materialWarehouseId, setMaterialWarehouseId] = useState("");
  const [bomId, setBomId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [processingFee, setProcessingFee] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [productionDate, setProductionDate] = useState("");
  const [remark, setRemark] = useState("");
  const [materialLines, setMaterialLines] = useState<MaterialLineForm[]>([emptyMaterialLine()]);

  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiFetch<ItemOption[]>("/api/items?pageSize=200", { signal: controller.signal }),
      apiFetch<WarehouseOption[]>("/api/warehouses?pageSize=100", { signal: controller.signal }),
      apiFetch<SupplierOption[]>("/api/business-partners?pageSize=200&type=SUPPLIER", { signal: controller.signal }),
      apiFetch<UomOption[]>("/api/unit-of-measures?pageSize=100", { signal: controller.signal }),
    ])
      .then(([it, w, s, u]) => {
        setItems(Array.isArray(it.data) ? it.data : []);
        setWarehouses(Array.isArray(w.data) ? w.data : []);
        setSuppliers(Array.isArray(s.data) ? s.data : []);
        setUoms(Array.isArray(u.data) ? u.data : []);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载基础数据失败", "NETWORK_ERROR"));
      });
    return () => controller.abort();
  }, []);

  const markDirty = () => setDirty(true);

  // 选择成品 → 加载该成品 ACTIVE 配方
  const handleItemChange = (id: string) => {
    setFinishedItemId(id);
    setBomId("");
    setBomDetail(null);
    markDirty();
    if (!id) return;
    apiFetch<BomOption[]>(`/api/boms?pageSize=50&finishedItemId=${id}&status=ACTIVE`)
      .then((body) => setBoms(Array.isArray(body.data) ? body.data : []))
      .catch(() => setBoms([]));
  };

  // 选择配方 → 加载配方行（前端预估需求量展示）
  const handleBomChange = (id: string) => {
    setBomId(id);
    setBomDetail(null);
    markDirty();
    if (!id) return;
    apiFetch<BomDetail>(`/api/boms/${id}`)
      .then((body) => setBomDetail(body.data))
      .catch(() => setBomDetail(null));
  };

  const estimatedQty = (qtyPerFinishedUnit: string, lossRate: string): string => {
    if (!plannedQty || Number(plannedQty) <= 0) return "—";
    const q = Number(plannedQty) * Number(qtyPerFinishedUnit) * (1 + Number(lossRate || 0));
    return q.toFixed(4);
  };

  const updateMaterialLine = (index: number, patch: Partial<MaterialLineForm>) => {
    setMaterialLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
    markDirty();
  };
  const handleMaterialItemChange = (index: number, itemId: string) => {
    const item = items.find((it) => it.id === itemId);
    updateMaterialLine(index, { itemId, uomId: item?.stockUom?.id ?? "" });
  };
  const addMaterialLine = () => {
    setMaterialLines((prev) => [...prev, emptyMaterialLine()]);
    markDirty();
  };
  const removeMaterialLine = (index: number) => {
    setMaterialLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
    markDirty();
  };

  const handleSubmit = async () => {
    if (submitting) return;
    const errs: Record<string, string> = {};
    if (!finishedItemId) errs.finishedItemId = "请选择成品";
    if (!plannedQty || Number(plannedQty) <= 0) errs.plannedQty = "产出数量必须大于 0";
    if (!warehouseId) errs.warehouseId = "请选择成品仓库";
    if (bomId && !materialWarehouseId) errs.materialWarehouseId = "BOM 模式请选择领料仓库";
    if (productionType === "OEM_OUTSOURCING") {
      if (!supplierId) errs.supplierId = "OEM 必须选择外协厂";
      if (processingFee === "" || Number(processingFee) < 0) errs.processingFee = "OEM 加工费必须 >= 0";
    }
    if (!bomId) {
      const valid = materialLines.filter((l) => l.itemId);
      if (valid.length === 0) errs.materialLines = "手工模式至少一行物料";
      for (const l of valid) {
        if (!l.quantity || Number(l.quantity) <= 0) errs["qty:" + l.key] = "领料数量必须大于 0";
        if (!l.warehouseId) errs["wh:" + l.key] = "请选择领料仓库";
      }
    }
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    setError(null);
    try {
      const body = await apiFetch<{ id: string }>("/api/production-orders", {
        method: "POST",
        body: JSON.stringify({
          productionType,
          finishedItemId,
          plannedQty: Number(plannedQty),
          warehouseId,
          ...(bomId ? { bomId, materialWarehouseId } : {}),
          ...(productionType === "OEM_OUTSOURCING" ? { supplierId, processingFee: Number(processingFee || 0) } : {}),
          batchNo: batchNo.trim() || null,
          productionDate: productionDate ? new Date(productionDate + "T00:00:00").toISOString() : null,
          remark: remark.trim() || null,
          ...(!bomId
            ? {
                materialLines: materialLines
                  .filter((l) => l.itemId)
                  .map((l) => ({
                    itemId: l.itemId,
                    quantity: Number(l.quantity),
                    uomId: l.uomId,
                    warehouseId: l.warehouseId,
                  })),
              }
            : {}),
        }),
      });
      router.push(`/inventory/production-orders/${body.data.id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <AppPage>
        <div className="border-border bg-surface shadow-elevation-sm rounded-lg border p-6">
          <p className="text-sm text-status-danger-text">加载基础数据失败：{loadError.message}</p>
        </div>
      </AppPage>
    );
  }

  return (
    <EntityFormWorkspace
      title="新建生产/外协工单"
      description="自产或 OEM 外协（我方供料 + 加工费）：POSTED 时同事务领料出库 → 成品入库（成本 = Σ原料成本 + 加工费）"
      backHref="/inventory/production-orders"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSubmit}
      onCancel={() => router.push("/inventory/production-orders")}
      saveLabel="保存工单"
    >
      <section className="rounded-md border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-primary">工单信息</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          <FormField label="工单类型" required>
            <select value={productionType} onChange={(e) => { setProductionType(e.target.value); markDirty(); }} className={inputClass}>
              <option value="SELF_MANUFACTURE">自产（本厂加工）</option>
              <option value="OEM_OUTSOURCING">OEM 外协（我方供料 + 加工费）</option>
            </select>
          </FormField>
          <FormField label="成品" required>
            <select value={finishedItemId} onChange={(e) => handleItemChange(e.target.value)} className={inputClass}>
              <option value="">请选择成品</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {`${it.code ?? ""} ${it.name ?? ""}`.trim()}
                </option>
              ))}
            </select>
            {fieldErrors.finishedItemId ? <span className="text-xs text-status-danger-text">{fieldErrors.finishedItemId}</span> : null}
          </FormField>
          <FormField label="产出数量" required>
            <input value={plannedQty} onChange={(e) => { setPlannedQty(e.target.value); markDirty(); }} className={`${inputClass} tabular-nums`} />
            {fieldErrors.plannedQty ? <span className="text-xs text-status-danger-text">{fieldErrors.plannedQty}</span> : null}
          </FormField>
          <FormField label="成品仓库" required>
            <select value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); markDirty(); }} className={inputClass}>
              <option value="">请选择仓库</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name ?? w.code ?? ""}</option>
              ))}
            </select>
            {fieldErrors.warehouseId ? <span className="text-xs text-status-danger-text">{fieldErrors.warehouseId}</span> : null}
          </FormField>
          <FormField label="配方（ACTIVE）">
            <select value={bomId} onChange={(e) => handleBomChange(e.target.value)} className={inputClass} disabled={!finishedItemId}>
              <option value="">手工工单（无配方）</option>
              {boms.map((b) => (
                <option key={b.id} value={b.id}>{`${b.bomNo}（v${b.bomVersion}）`}</option>
              ))}
            </select>
            {finishedItemId && boms.length === 0 ? (
              <span className="text-xs text-ink-muted">该成品暂无生效配方，可用手工工单</span>
            ) : null}
          </FormField>
          {bomId ? (
            <FormField label="领料仓库" required hint="BOM 模式">
              <select value={materialWarehouseId} onChange={(e) => { setMaterialWarehouseId(e.target.value); markDirty(); }} className={inputClass}>
                <option value="">请选择领料仓库</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name ?? w.code ?? ""}</option>
                ))}
              </select>
              {fieldErrors.materialWarehouseId ? <span className="text-xs text-status-danger-text">{fieldErrors.materialWarehouseId}</span> : null}
            </FormField>
          ) : null}
          {productionType === "OEM_OUTSOURCING" ? (
            <>
              <FormField label="外协厂（OEM）" required>
                <select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); markDirty(); }} className={inputClass}>
                  <option value="">请选择外协厂</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name ?? s.code ?? ""}</option>
                  ))}
                </select>
                {fieldErrors.supplierId ? <span className="text-xs text-status-danger-text">{fieldErrors.supplierId}</span> : null}
              </FormField>
              <FormField label="加工费（计入成品成本）" required>
                <input value={processingFee} onChange={(e) => { setProcessingFee(e.target.value); markDirty(); }} className={`${inputClass} tabular-nums`} />
                {fieldErrors.processingFee ? <span className="text-xs text-status-danger-text">{fieldErrors.processingFee}</span> : null}
              </FormField>
            </>
          ) : null}
          <FormField label="批次">
            <input value={batchNo} onChange={(e) => { setBatchNo(e.target.value); markDirty(); }} className={inputClass} />
          </FormField>
          <FormField label="完工日期">
            <input type="date" value={productionDate} onChange={(e) => { setProductionDate(e.target.value); markDirty(); }} className={inputClass} />
          </FormField>
          <FormField label="备注">
            <input value={remark} onChange={(e) => { setRemark(e.target.value); markDirty(); }} className={inputClass} />
          </FormField>
        </div>
      </section>

      {bomId && bomDetail ? (
        <section className="rounded-md border border-border p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink-primary">
            配方领料预估（{bomDetail.bomNo}）——提交后服务端按配方权威计算
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="text-ink-secondary bg-canvas text-left text-xs font-medium">
                <tr>
                  <th className="px-4 py-2 font-semibold">原料</th>
                  <th className="px-4 py-2 font-semibold">单位</th>
                  <th className="px-4 py-2 text-right font-semibold">系数</th>
                  <th className="px-4 py-2 text-right font-semibold">损耗率</th>
                  <th className="px-4 py-2 text-right font-semibold">预估领料量</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(bomDetail.lines ?? []).map((l, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2">{`${l.componentItem?.code ?? ""} ${l.componentItem?.name ?? ""}`.trim() || "—"}</td>
                    <td className="px-4 py-2">{l.componentUom?.symbol ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{l.qtyPerFinishedUnit}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{Number(l.lossRate) > 0 ? `${(Number(l.lossRate) * 100).toFixed(2)}%` : "—"}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums text-brand-700">
                      {estimatedQty(l.qtyPerFinishedUnit, l.lossRate)} {l.componentUom?.symbol ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : !bomId ? (
        <section className="rounded-md border border-border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink-primary">手工领料行（无配方）</h2>
            <button type="button" onClick={addMaterialLine} className="rounded-md border border-border px-3 py-1 text-xs font-medium text-ink-primary hover:bg-canvas">
              + 添加物料
            </button>
          </div>
          {fieldErrors.materialLines ? <p className="mb-2 text-xs text-status-danger-text">{fieldErrors.materialLines}</p> : null}
          <div className="space-y-2">
            {materialLines.map((l, i) => (
              <div key={l.key} className="border-border flex flex-wrap items-end gap-3 rounded-md border p-3">
                <div className="min-w-[180px] flex-1">
                  <span className="block text-xs text-ink-secondary">物料</span>
                  <select value={l.itemId} onChange={(e) => handleMaterialItemChange(i, e.target.value)} className={inputClass}>
                    <option value="">请选择物料</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {`${it.code ?? ""} ${it.name ?? ""}`.trim()}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-32">
                  <span className="block text-xs text-ink-secondary">领料数量 *</span>
                  <input value={l.quantity} onChange={(e) => updateMaterialLine(i, { quantity: e.target.value })} className={`${inputClass} tabular-nums`} />
                  {fieldErrors["qty:" + l.key] ? <span className="text-xs text-status-danger-text">{fieldErrors["qty:" + l.key]}</span> : null}
                </div>
                <div className="w-28">
                  <span className="block text-xs text-ink-secondary">单位（库存单位）</span>
                  <input value={l.uomId ? uoms.find((u) => u.id === l.uomId)?.symbol ?? "" : ""} readOnly className={inputClass} />
                </div>
                <div className="w-40">
                  <span className="block text-xs text-ink-secondary">领料仓库 *</span>
                  <select value={l.warehouseId} onChange={(e) => updateMaterialLine(i, { warehouseId: e.target.value })} className={inputClass}>
                    <option value="">请选择仓库</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{w.name ?? w.code ?? ""}</option>
                    ))}
                  </select>
                  {fieldErrors["wh:" + l.key] ? <span className="text-xs text-status-danger-text">{fieldErrors["wh:" + l.key]}</span> : null}
                </div>
                <button type="button" onClick={() => removeMaterialLine(i)} className="rounded-md border border-status-danger-border px-2 py-1 text-xs text-status-danger-text hover:bg-status-danger-bg/10">
                  删除
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("production-order", "create")}>
      <AppPage>
        <OrderCreateForm />
      </AppPage>
    </PermissionGuard>
  );
}
