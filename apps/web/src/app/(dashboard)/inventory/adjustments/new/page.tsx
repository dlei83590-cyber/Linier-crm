"use client";

/**
 * Inventory Adjustment Create — 新建库存调整单（F2-6B 批 3 + UI-09 FE2.0 表单统一）
 *
 * 契约：POST /api/inventory-adjustments（inventory-adjustment:create），创建即取号 ADJ，初始 DRAFT。
 * Header：reasonCode（必填）/ sourceStockCountId（可选，来源盘点差异）/ remark。
 * Lines：warehouse / location / item / direction(IN|OUT) / quantity(>0) / batchNo / serialNo。
 * 金额/库存落账由后端执行（红线：前端不直写库存、不计算余额）。
 * PermissionGuard 对齐 API requirePermission("inventory-adjustment:create")。
 *
 * UI-09：迁移至 EntityFormWorkspace（Dirty-State Guard / 409 冲突面板 / ErrorPanel /
 * 统一 Save/Cancel），移除页面级 window.confirm；行表格数字列右对齐 tabular-nums。
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { FormField } from "@/components/ui/form-field";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { INPUT_CLASS } from "@/lib/ui-classes";

interface WarehouseOption { id: string; code: string | null; name: string | null }
interface LocationOption { id: string; code: string | null; name: string | null }
interface ItemOption { id: string; code: string | null; name: string | null; stockUom?: { id: string; code: string | null; symbol: string | null } | null }

interface LineForm {
  warehouseId: string;
  locationId: string;
  itemId: string;
  direction: "IN" | "OUT";
  quantity: string;
  batchNo: string;
  serialNo: string;
  uomId: string;
}

const EMPTY_LINE: LineForm = {
  warehouseId: "",
  locationId: "",
  itemId: "",
  direction: "OUT",
  quantity: "",
  batchNo: "",
  serialNo: "",
  uomId: "",
};

const REASON_CODES = ["COUNT_VARIANCE", "DAMAGE", "LOSS", "GIFT", "SYSTEM_CORRECTION", "MANUAL"];

function AdjustmentCreateForm() {
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [reasonCode, setReasonCode] = useState("MANUAL");
  const [remark, setRemark] = useState("");
  const [lines, setLines] = useState<LineForm[]>([{ ...EMPTY_LINE }]);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiFetch<WarehouseOption[]>("/api/warehouses?pageSize=100", { signal: controller.signal }),
      apiFetch<LocationOption[]>("/api/warehouse-locations?pageSize=100", { signal: controller.signal }),
      apiFetch<ItemOption[]>("/api/items?pageSize=100", { signal: controller.signal }),
    ])
      .then(([w, l, it]) => {
        setWarehouses(w.data);
        setLocations(l.data);
        setItems(it.data);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof ApiClientError ? err : new ApiClientError(0, "加载基础数据失败", "NETWORK_ERROR"),
        );
      });
    return () => controller.abort();
  }, []);

  const markDirty = () => setDirty(true);

  const updateLine = (idx: number, patch: Partial<LineForm>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    markDirty();
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
    if (!reasonCode) errs.reasonCode = "请选择原因码";
    lines.forEach((l, i) => {
      if (!l.warehouseId) errs[`lines.${i}.warehouseId`] = "请选择仓库";
      if (!l.itemId) errs[`lines.${i}.itemId`] = "请选择物料";
      if (!l.quantity || Number(l.quantity) <= 0) errs[`lines.${i}.quantity`] = "数量必须大于 0";
    });
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        reasonCode,
        ...(remark.trim() ? { remark: remark.trim() } : {}),
        lines: lines.map((l) => ({
          warehouseId: l.warehouseId,
          ...(l.locationId ? { locationId: l.locationId } : {}),
          itemId: l.itemId,
          direction: l.direction,
          quantity: Number(l.quantity),
          ...(l.batchNo.trim() ? { batchNo: l.batchNo.trim() } : {}),
          ...(l.serialNo.trim() ? { serialNo: l.serialNo.trim() } : {}),
          ...(l.uomId ? { uomId: l.uomId } : {}),
        })),
      };
      const body = await apiFetch<{ id: string }>("/api/inventory-adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setDirty(false);
      router.push(`/inventory/adjustments/${body.data.id}`);
    } catch (err: unknown) {
      setError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "创建失败", "NETWORK_ERROR"),
      );
      setSubmitting(false);
    }
  };

  return (
    <EntityFormWorkspace
      title="新建库存调整单"
      description="创建即取号 ADJ（DRAFT）；调整行库存落账由后端 Shared LedgerCommand 执行。"
      backHref="/inventory/adjustments"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSubmit}
      onCancel={() => router.push("/inventory/adjustments")}
      saveLabel="创建（草稿）"
    >
      <section className="rounded-md border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-primary">调整信息</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FormField label="原因码" required>
            <select
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              className={INPUT_CLASS}
            >
              {REASON_CODES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            {fieldErrors.reasonCode ? (
              <span className="text-xs text-status-danger-text">{fieldErrors.reasonCode}</span>
            ) : null}
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

      <section className="rounded-md border border-border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-primary">调整行（至少一行）</h2>
          <button
            type="button"
            onClick={addLine}
            className="rounded-md border border-border px-3 py-1 text-xs font-medium text-ink-primary hover:bg-canvas"
          >
            + 添加行
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
              <tr>
                <th className="px-3 py-2 font-semibold">仓库</th>
                <th className="px-3 py-2 font-semibold">库位</th>
                <th className="px-3 py-2 font-semibold">物料</th>
                <th className="px-3 py-2 font-semibold">方向</th>
                <th className="px-3 py-2 text-right font-semibold">数量</th>
                <th className="px-3 py-2 font-semibold">批次</th>
                <th className="px-3 py-2 font-semibold">序列号</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((line, idx) => (
                <tr key={idx}>
                  <td className="px-2 py-2">
                    <select
                      value={line.warehouseId}
                      onChange={(e) => updateLine(idx, { warehouseId: e.target.value })}
                      className={INPUT_CLASS}
                    >
                      <option value="">选择仓库</option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>{w.code ?? ""} {w.name ?? ""}</option>
                      ))}
                    </select>
                    {fieldErrors[`lines.${idx}.warehouseId`] ? (
                      <span className="text-xs text-status-danger-text">{fieldErrors[`lines.${idx}.warehouseId`]}</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={line.locationId}
                      onChange={(e) => updateLine(idx, { locationId: e.target.value })}
                      className={INPUT_CLASS}
                    >
                      <option value="">未指定</option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>{l.code ?? ""} {l.name ?? ""}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={line.itemId}
                      onChange={(e) => {
                        const item = items.find((it) => it.id === e.target.value);
                        updateLine(idx, { itemId: e.target.value, uomId: item?.stockUom?.id ?? "" });
                      }}
                      className={INPUT_CLASS}
                    >
                      <option value="">选择物料</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>{it.code ?? ""} {it.name ?? ""}</option>
                      ))}
                    </select>
                    {fieldErrors[`lines.${idx}.itemId`] ? (
                      <span className="text-xs text-status-danger-text">{fieldErrors[`lines.${idx}.itemId`]}</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={line.direction}
                      onChange={(e) => updateLine(idx, { direction: e.target.value as "IN" | "OUT" })}
                      className={INPUT_CLASS}
                    >
                      <option value="OUT">OUT（出库）</option>
                      <option value="IN">IN（入库）</option>
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={line.quantity}
                      onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                      className={`${INPUT_CLASS} w-24 text-right tabular-nums`}
                    />
                    {fieldErrors[`lines.${idx}.quantity`] ? (
                      <span className="text-xs text-status-danger-text">{fieldErrors[`lines.${idx}.quantity`]}</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={line.batchNo}
                      onChange={(e) => updateLine(idx, { batchNo: e.target.value })}
                      maxLength={100}
                      className={INPUT_CLASS}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={line.serialNo}
                      onChange={(e) => updateLine(idx, { serialNo: e.target.value })}
                      maxLength={100}
                      className={INPUT_CLASS}
                    />
                  </td>
                  <td className="px-2 py-2">
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
        {Object.keys(fieldErrors).length > 0 ? (
          <p className="mt-2 text-xs text-status-danger-text">
            {Object.values(fieldErrors).filter(Boolean)[0] ?? ""}
          </p>
        ) : null}
      </section>
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("inventory-adjustment", "create")}>
      <AppPage>
        <AdjustmentCreateForm />
      </AppPage>
    </PermissionGuard>
  );
}
