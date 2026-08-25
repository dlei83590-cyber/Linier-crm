"use client";

/**
 * Inventory Transfers Create — 新建库存调拨单（F2-6B 批 3 + UI-09 FE2.0 表单统一）
 *
 * 契约：POST /api/inventory-transfers（inventory-transfer:create），创建即取号 TRF，初始 DRAFT。
 * Header：源/目标仓库 + 可选库位 + 备注；Lines：item / uom / quantity / batch / serialNos / dates。
 * PermissionGuard 对齐 API requirePermission("inventory-transfer:create")。
 *
 * UI-09：迁移至 EntityFormWorkspace（Dirty-State Guard / 409 冲突面板 / ErrorPanel /
 * 统一 Save/Cancel），移除页面级 window.confirm；数量列右对齐 tabular-nums。
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { FormField } from "@/components/ui/form-field";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { INPUT_CLASS } from "@/lib/ui-classes";
import { filterLocationsByWarehouse, splitSerialNos } from "@/lib/inventory/transfer-form";

interface ItemOption {
  id: string;
  code: string | null;
  name: string | null;
  stockUom?: { id: string; code: string | null; symbol: string | null } | null;
}

interface WarehouseOption {
  id: string;
  code: string | null;
  name: string | null;
}

interface LocationOption {
  id: string;
  code: string | null;
  name: string | null;
  warehouseId?: string | null;
}

interface LineForm {
  itemId: string;
  uomId: string;
  quantity: string;
  batchNo: string;
  serialNos: string;
  mfgDate: string;
  expDate: string;
  remark: string;
}

const EMPTY_LINE: LineForm = {
  itemId: "",
  uomId: "",
  quantity: "",
  batchNo: "",
  serialNos: "",
  mfgDate: "",
  expDate: "",
  remark: "",
};

function TransferCreateForm() {
  const router = useRouter();
  const [items, setItems] = useState<ItemOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [sourceWarehouseId, setSourceWarehouseId] = useState("");
  const [sourceLocationId, setSourceLocationId] = useState("");
  const [destinationWarehouseId, setDestinationWarehouseId] = useState("");
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [remark, setRemark] = useState("");
  const [lines, setLines] = useState<LineForm[]>([{ ...EMPTY_LINE }]);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // 数据源：items / warehouses / warehouse-locations 真实下拉（Master-Data Read API，PR #33）
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiFetch<ItemOption[]>("/api/items?pageSize=100", { signal: controller.signal }),
      apiFetch<WarehouseOption[]>("/api/warehouses?pageSize=100", { signal: controller.signal }),
      apiFetch<LocationOption[]>("/api/warehouse-locations?pageSize=100", { signal: controller.signal }),
    ])
      .then(([it, w, l]) => {
        setItems(it.data);
        setWarehouses(w.data);
        setLocations(l.data);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof ApiClientError
            ? err
            : new ApiClientError(0, "加载基础数据失败", "NETWORK_ERROR"),
        );
      });
    return () => controller.abort();
  }, []);

  // 切换仓库时若已选库位不属于新仓库则清空（避免提交 422 组合 FK 校验失败）
  const handleWarehouseChange = (
    kind: "source" | "destination",
    warehouseId: string,
    setter: (v: string) => void,
    locationSetter: (v: string) => void,
  ) => {
    setter(warehouseId);
    markDirty();
    const currentLocationId = kind === "source" ? sourceLocationId : destinationLocationId;
    if (
      currentLocationId &&
      !filterLocationsByWarehouse(locations, warehouseId).some((l) => l.id === currentLocationId)
    ) {
      locationSetter("");
    }
  };

  const markDirty = () => setDirty(true);

  const updateLine = (idx: number, patch: Partial<LineForm>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    markDirty();
    if (patch.itemId) {
      const item = items.find((it) => it.id === patch.itemId);
      if (item?.stockUom?.id) {
        setLines((prev) =>
          prev.map((l, i) => (i === idx ? { ...l, uomId: item.stockUom?.id ?? l.uomId } : l)),
        );
      }
    }
  };

  const addLine = () => {
    setLines((prev) => [...prev, { ...EMPTY_LINE }]);
    markDirty();
  };

  const removeLine = (idx: number) => {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
    markDirty();
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!sourceWarehouseId.trim()) errs.sourceWarehouseId = "请选择源仓库";
    if (!destinationWarehouseId.trim()) errs.destinationWarehouseId = "请选择目标仓库";
    lines.forEach((l, i) => {
      if (!l.itemId) errs[`lines.${i}.itemId`] = "请选择物料";
      if (!l.quantity || Number(l.quantity) <= 0) errs[`lines.${i}.quantity`] = "数量必须大于 0";
    });
    if (lines.length === 0) errs.lines = "至少需要一行";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        sourceWarehouseId: sourceWarehouseId.trim(),
        ...(sourceLocationId.trim() ? { sourceLocationId: sourceLocationId.trim() } : {}),
        destinationWarehouseId: destinationWarehouseId.trim(),
        ...(destinationLocationId.trim()
          ? { destinationLocationId: destinationLocationId.trim() }
          : {}),
        ...(remark ? { remark } : {}),
        lines: lines.map((l) => ({
          itemId: l.itemId,
          ...(l.uomId ? { uomId: l.uomId } : {}),
          quantity: Number(l.quantity),
          ...(l.batchNo ? { batchNo: l.batchNo } : {}),
          ...(splitSerialNos(l.serialNos).length
            ? { serialNos: splitSerialNos(l.serialNos) }
            : {}),
          ...(l.mfgDate ? { mfgDate: l.mfgDate } : {}),
          ...(l.expDate ? { expDate: l.expDate } : {}),
          ...(l.remark ? { remark: l.remark } : {}),
        })),
      };
      const body = await apiFetch<{ transfer: { id: string } }>("/api/inventory-transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setDirty(false);
      // Success refresh：使用服务端返回事实导航到详情（权威 re-GET）
      router.push(`/inventory/transfers/${body.data.transfer.id}`);
    } catch (err: unknown) {
      setError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "创建失败", "NETWORK_ERROR"),
      );
      setSubmitting(false);
    }
  };

  return (
    <EntityFormWorkspace
      title="新建库存调拨"
      description="源仓库 → 目标仓库 双边调拨（创建 DRAFT；提交/执行在详情页进行）。仓库/库位来自主数据只读 API，库位按所选仓库过滤。"
      backHref="/inventory/transfers"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSubmit}
      onCancel={() => router.push("/inventory/transfers")}
      saveLabel="创建（草稿）"
    >
      <section className="rounded-md border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-primary">调拨信息</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <FormField label="源仓库" required>
            <select
              value={sourceWarehouseId}
              onChange={(e) => handleWarehouseChange("source", e.target.value, setSourceWarehouseId, setSourceLocationId)}
              className={INPUT_CLASS}
            >
              <option value="">选择仓库</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.code ?? ""} {w.name ?? ""}</option>
              ))}
            </select>
            {fieldErrors.sourceWarehouseId ? (
              <span className="text-xs text-status-danger-text">{fieldErrors.sourceWarehouseId}</span>
            ) : null}
          </FormField>
          <FormField label="源库位（可选）">
            <select
              value={sourceLocationId}
              onChange={(e) => {
                setSourceLocationId(e.target.value);
                markDirty();
              }}
              disabled={!sourceWarehouseId}
              className={INPUT_CLASS}
            >
              <option value="">未指定</option>
              {filterLocationsByWarehouse(locations, sourceWarehouseId).map((l) => (
                <option key={l.id} value={l.id}>{l.code ?? ""} {l.name ?? ""}</option>
              ))}
            </select>
          </FormField>
          <FormField label="目标仓库" required>
            <select
              value={destinationWarehouseId}
              onChange={(e) => handleWarehouseChange("destination", e.target.value, setDestinationWarehouseId, setDestinationLocationId)}
              className={INPUT_CLASS}
            >
              <option value="">选择仓库</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.code ?? ""} {w.name ?? ""}</option>
              ))}
            </select>
            {fieldErrors.destinationWarehouseId ? (
              <span className="text-xs text-status-danger-text">{fieldErrors.destinationWarehouseId}</span>
            ) : null}
          </FormField>
          <FormField label="目标库位（可选）">
            <select
              value={destinationLocationId}
              onChange={(e) => {
                setDestinationLocationId(e.target.value);
                markDirty();
              }}
              disabled={!destinationWarehouseId}
              className={INPUT_CLASS}
            >
              <option value="">未指定</option>
              {filterLocationsByWarehouse(locations, destinationWarehouseId).map((l) => (
                <option key={l.id} value={l.id}>{l.code ?? ""} {l.name ?? ""}</option>
              ))}
            </select>
          </FormField>
          <div className="col-span-1 md:col-span-4">
            <FormField label="备注（可选，≤500）">
              <textarea
                value={remark}
                onChange={(e) => {
                  setRemark(e.target.value);
                  markDirty();
                }}
                rows={2}
                maxLength={500}
                className={INPUT_CLASS}
              />
            </FormField>
          </div>
        </div>
      </section>

      <section className="rounded-md border border-border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-primary">调拨明细（至少一行）</h2>
          <button
            type="button"
            onClick={addLine}
            className="rounded-md border border-border px-3 py-1 text-xs font-medium text-ink-primary hover:bg-canvas"
          >
            + 添加行
          </button>
        </div>
        {fieldErrors.lines ? (
          <p className="mb-2 text-xs text-status-danger-text">{fieldErrors.lines}</p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
              <tr>
                <th className="px-3 py-2 font-semibold">物料</th>
                <th className="px-3 py-2 text-right font-semibold">数量</th>
                <th className="px-3 py-2 font-semibold">单位</th>
                <th className="px-3 py-2 font-semibold">批次</th>
                <th className="px-3 py-2 font-semibold">序列号（逗号分隔）</th>
                <th className="px-3 py-2 font-semibold">生产日期</th>
                <th className="px-3 py-2 font-semibold">有效期至</th>
                <th className="px-3 py-2 font-semibold">备注</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((line, idx) => (
                <tr key={idx}>
                  <td className="px-3 py-2">
                    <select
                      value={line.itemId}
                      onChange={(e) => updateLine(idx, { itemId: e.target.value })}
                      className={INPUT_CLASS}
                    >
                      <option value="">选择物料</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.code ?? ""} {it.name ?? ""}
                        </option>
                      ))}
                    </select>
                    {fieldErrors[`lines.${idx}.itemId`] ? (
                      <p className="mt-0.5 text-xs text-status-danger-text">
                        {fieldErrors[`lines.${idx}.itemId`]}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={line.quantity}
                      onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                      className={`${INPUT_CLASS} w-24 text-right tabular-nums`}
                    />
                    {fieldErrors[`lines.${idx}.quantity`] ? (
                      <p className="mt-0.5 text-xs text-status-danger-text">
                        {fieldErrors[`lines.${idx}.quantity`]}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-ink-secondary">
                    {line.uomId
                      ? (items.find((it) => it.id === line.itemId)?.stockUom?.symbol ?? "—")
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={line.batchNo}
                      onChange={(e) => updateLine(idx, { batchNo: e.target.value })}
                      placeholder="可选"
                      className={INPUT_CLASS}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={line.serialNos}
                      onChange={(e) => updateLine(idx, { serialNos: e.target.value })}
                      placeholder="SN1,SN2"
                      className={INPUT_CLASS}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="date"
                      value={line.mfgDate}
                      onChange={(e) => updateLine(idx, { mfgDate: e.target.value })}
                      className={INPUT_CLASS}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="date"
                      value={line.expDate}
                      onChange={(e) => updateLine(idx, { expDate: e.target.value })}
                      className={INPUT_CLASS}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={line.remark}
                      onChange={(e) => updateLine(idx, { remark: e.target.value })}
                      placeholder="可选"
                      className={INPUT_CLASS}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => removeLine(idx)}
                      disabled={lines.length <= 1}
                      className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission="inventory-transfer:create">
      <AppPage>
        <TransferCreateForm />
      </AppPage>
    </PermissionGuard>
  );
}
