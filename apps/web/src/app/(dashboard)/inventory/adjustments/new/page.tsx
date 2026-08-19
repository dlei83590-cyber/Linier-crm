"use client";

/**
 * Inventory Adjustment Create — 新建库存调整单（F2-6B 批 3）
 *
 * 契约：POST /api/inventory-adjustments（inventory-adjustment:create），创建即取号 ADJ，初始 DRAFT。
 * Header：reasonCode（必填）/ sourceStockCountId（可选，来源盘点差异）/ remark。
 * Lines：warehouse / location / item / direction(IN|OUT) / quantity(>0) / batchNo / serialNo。
 * 金额/库存落账由后端执行（红线：前端不直写库存、不计算余额）。
 * PermissionGuard 对齐 API requirePermission("inventory-adjustment:create")。
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { CARD_CLASS } from "@/lib/ui-classes";

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

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

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
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center justify-between border-b border-border p-4">
        <h1 className="text-lg font-semibold text-ink-primary">新建库存调整单</h1>
        <Link
          href="/inventory/adjustments"
          onClick={(e) => {
            if (dirty && !window.confirm("有未保存的更改，确定离开？")) e.preventDefault();
          }}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-canvas"
        >
          返回列表
        </Link>
      </div>

      <div className="p-4">
        {error && (
          <div className="mb-4 rounded-md bg-status-danger-bg p-3 text-sm text-status-danger-text">
            <p>
              {describeStatus(error.status)}：{error.message}
              {error.code ? `（${error.code}）` : ""}
            </p>
          </div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-4 rounded-md bg-canvas p-4 text-sm md:grid-cols-3">
          <div>
            <label className="block text-xs text-ink-secondary">原因码 *</label>
            <select
              value={reasonCode}
              onChange={(e) => {
                setReasonCode(e.target.value);
                markDirty();
              }}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
            >
              {REASON_CODES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            {fieldErrors.reasonCode && <p className="mt-0.5 text-xs text-status-danger-text">{fieldErrors.reasonCode}</p>}
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-ink-secondary">备注（可选，≤500）</label>
            <input
              value={remark}
              onChange={(e) => {
                setRemark(e.target.value);
                markDirty();
              }}
              maxLength={500}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
            />
          </div>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink-secondary">调整行（至少一行）</h2>
          <button
            type="button"
            onClick={addLine}
            className="bg-brand-600 hover:bg-brand-700 rounded-md px-3 py-1.5 text-sm font-medium text-white"
          >
            + 添加行
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
              <tr>
                <th className="px-2 py-2">仓库</th>
                <th className="px-2 py-2">库位</th>
                <th className="px-2 py-2">物料</th>
                <th className="px-2 py-2">方向</th>
                <th className="px-2 py-2">数量</th>
                <th className="px-2 py-2">批次</th>
                <th className="px-2 py-2">序列号</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((line, idx) => (
                <tr key={idx}>
                  <td className="px-2 py-2">
                    <select
                      value={line.warehouseId}
                      onChange={(e) => updateLine(idx, { warehouseId: e.target.value })}
                      className="focus:border-brand-500 w-full min-w-28 rounded-md border border-border px-2 py-1.5 focus:outline-none"
                    >
                      <option value="">选择仓库</option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>{w.code ?? ""} {w.name ?? ""}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={line.locationId}
                      onChange={(e) => updateLine(idx, { locationId: e.target.value })}
                      className="focus:border-brand-500 w-full min-w-24 rounded-md border border-border px-2 py-1.5 focus:outline-none"
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
                      className="focus:border-brand-500 w-full min-w-32 rounded-md border border-border px-2 py-1.5 focus:outline-none"
                    >
                      <option value="">选择物料</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>{it.code ?? ""} {it.name ?? ""}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={line.direction}
                      onChange={(e) => updateLine(idx, { direction: e.target.value as "IN" | "OUT" })}
                      className="focus:border-brand-500 rounded-md border border-border px-2 py-1.5 focus:outline-none"
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
                      className="focus:border-brand-500 w-24 rounded-md border border-border px-2 py-1.5 focus:outline-none"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={line.batchNo}
                      onChange={(e) => updateLine(idx, { batchNo: e.target.value })}
                      maxLength={100}
                      className="focus:border-brand-500 w-24 rounded-md border border-border px-2 py-1.5 focus:outline-none"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={line.serialNo}
                      onChange={(e) => updateLine(idx, { serialNo: e.target.value })}
                      maxLength={100}
                      className="focus:border-brand-500 w-24 rounded-md border border-border px-2 py-1.5 focus:outline-none"
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
        {Object.keys(fieldErrors).length > 0 && (
          <p className="mt-2 text-xs text-status-danger-text">
            {Object.values(fieldErrors).filter(Boolean)[0] ?? ""}
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-brand-600 hover:bg-brand-700 rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "提交中…" : "创建（DRAFT）"}
          </button>
          {dirty && <span className="text-xs text-status-warning-text">有未保存的更改</span>}
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("inventory-adjustment", "create")}>
      <AdjustmentCreateForm />
    </PermissionGuard>
  );
}