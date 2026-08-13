"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";

interface SupplierOption {
  id: string;
  code: string | null;
  name: string | null;
}

interface ItemOption {
  id: string;
  code: string | null;
  name: string | null;
  model: string | null;
}

interface UomOption {
  id: string;
  code: string | null;
  name: string | null;
  symbol: string | null;
}

interface POCreateLine {
  itemId: string;
  description: string;
  quantity: string;
  uomId: string;
  priceSource: "SUPPLIER_PRICE_SNAPSHOT" | "MANUAL";
  unitPrice: string;
  priceReason: string;
}

const emptyLine = (): POCreateLine => ({
  itemId: "",
  description: "",
  quantity: "",
  uomId: "",
  priceSource: "SUPPLIER_PRICE_SNAPSHOT",
  unitPrice: "",
  priceReason: "",
});

function PurchaseOrderCreateForm() {
  const router = useRouter();

  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [uoms, setUoms] = useState<UomOption[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [currency, setCurrency] = useState("");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [remark, setRemark] = useState("");
  const [lines, setLines] = useState<POCreateLine[]>([emptyLine()]);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // 数据源：FINAL read API（suppliers / items / unit-of-measures，形态 A 兼容）
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<SupplierOption[] | { total: number; page: number; pageSize: number; items: SupplierOption[] }>(
      "/api/suppliers?pageSize=100",
      { signal: controller.signal },
    )
      .then((body) => setSuppliers(Array.isArray(body.data) ? body.data : (body.data.items ?? [])))
      .catch(() => setSuppliers([]));
    apiFetch<ItemOption[] | { total: number; page: number; pageSize: number; items: ItemOption[] }>(
      "/api/items?pageSize=100",
      { signal: controller.signal },
    )
      .then((body) => setItems(Array.isArray(body.data) ? body.data : (body.data.items ?? [])))
      .catch(() => setItems([]));
    apiFetch<UomOption[] | { total: number; page: number; pageSize: number; items: UomOption[] }>(
      "/api/unit-of-measures?pageSize=100",
      { signal: controller.signal },
    )
      .then((body) => setUoms(Array.isArray(body.data) ? body.data : (body.data.items ?? [])))
      .catch(() => setUoms([]));
    return () => controller.abort();
  }, []);

  // Dirty state（离开页面确认 + beforeunload）
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

  const updateLine = (idx: number, patch: Partial<POCreateLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    markDirty();
  };

  const addLine = () => {
    setLines((prev) => [...prev, emptyLine()]);
    markDirty();
  };

  const removeLine = (idx: number) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
    markDirty();
  };

  // 三层 validation（仅 UX 层；领域事实以服务端为准）
  const validate = (): boolean => {
    const fe: Record<string, string> = {};
    if (!supplierId) fe.supplierId = "请选择供应商";
    lines.forEach((l, idx) => {
      if (!l.itemId) fe[`line-${idx}-itemId`] = "请选择物料";
      const qty = Number(l.quantity);
      if (!l.quantity || !Number.isFinite(qty) || qty <= 0) fe[`line-${idx}-quantity`] = "数量必须 > 0";
      if (l.priceSource === "MANUAL") {
        const price = Number(l.unitPrice);
        if (!l.unitPrice || !Number.isFinite(price) || price <= 0) {
          fe[`line-${idx}-unitPrice`] = "MANUAL 价格必须 > 0";
        }
        if (!l.priceReason.trim()) fe[`line-${idx}-priceReason`] = "MANUAL 必须填写价格依据";
      }
    });
    setFieldErrors(fe);
    return Object.keys(fe).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = await apiFetch<{ id: string }>("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          ...(currency.trim() ? { currency: currency.trim() } : {}),
          ...(expectedDeliveryDate ? { expectedDeliveryDate } : {}),
          ...(remark.trim() ? { remark: remark.trim() } : {}),
          lines: lines.map((l) => ({
            itemId: l.itemId,
            ...(l.description.trim() ? { description: l.description.trim() } : {}),
            quantity: Number(l.quantity),
            ...(l.uomId ? { uomId: l.uomId } : {}),
            priceSource: l.priceSource,
            ...(l.priceSource === "MANUAL"
              ? { unitPrice: Number(l.unitPrice), priceReason: l.priceReason.trim() }
              : {}),
          })),
        }),
      });
      // Success convergence：服务端返回 id 导航（权威）
      router.push(`/purchasing/orders/${body.data.id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 p-4">
        <h1 className="text-lg font-semibold text-slate-800">新建采购订单（DRAFT）</h1>
        <Link
          href="/purchasing/orders"
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          返回列表
        </Link>
      </div>

      <div className="space-y-4 p-4">
        {/* 供应商（FINAL read API） */}
        <div>
          <label className="text-xs font-medium text-slate-500">供应商 *</label>
          <select
            value={supplierId}
            onChange={(e) => {
              setSupplierId(e.target.value);
              markDirty();
            }}
            className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          >
            <option value="">请选择供应商</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
          {fieldErrors.supplierId && <p className="mt-1 text-xs text-red-600">{fieldErrors.supplierId}</p>}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-slate-500">币种（可选）</label>
            <input
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value);
                markDirty();
              }}
              placeholder="如 CNY / USD"
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500">期望交货日期（可选）</label>
            <input
              type="date"
              value={expectedDeliveryDate}
              onChange={(e) => {
                setExpectedDeliveryDate(e.target.value);
                markDirty();
              }}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-500">备注（可选）</label>
          <textarea
            value={remark}
            onChange={(e) => {
              setRemark(e.target.value);
              markDirty();
            }}
            rows={2}
            className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
        </div>

        {/* Lines（全量替换；金额服务端 Decimal 聚合，客户端不传总额） */}
        <div className="rounded-md border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
            <p className="text-sm font-medium text-slate-700">订单行</p>
            <button
              type="button"
              onClick={addLine}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              + 添加行
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-3 py-2">物料 *</th>
                  <th className="px-3 py-2">描述</th>
                  <th className="px-3 py-2">数量 *</th>
                  <th className="px-3 py-2">计量单位</th>
                  <th className="px-3 py-2">价格来源</th>
                  <th className="px-3 py-2">单价（MANUAL）</th>
                  <th className="px-3 py-2">价格依据（MANUAL）</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((line, idx) => (
                  <tr key={idx}>
                    <td className="px-3 py-2">
                      <select
                        value={line.itemId}
                        onChange={(e) => updateLine(idx, { itemId: e.target.value })}
                        className="w-40 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                      >
                        <option value="">选择物料</option>
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.code} · {it.name}
                          </option>
                        ))}
                      </select>
                      {fieldErrors[`line-${idx}-itemId`] && (
                        <p className="mt-1 text-xs text-red-600">{fieldErrors[`line-${idx}-itemId`]}</p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={line.description}
                        onChange={(e) => updateLine(idx, { description: e.target.value })}
                        className="w-32 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={line.quantity}
                        onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                        className="w-24 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                      />
                      {fieldErrors[`line-${idx}-quantity`] && (
                        <p className="mt-1 text-xs text-red-600">{fieldErrors[`line-${idx}-quantity`]}</p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={line.uomId}
                        onChange={(e) => updateLine(idx, { uomId: e.target.value })}
                        className="w-28 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                      >
                        <option value="">选择单位</option>
                        {uoms.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.symbol || u.code || u.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={line.priceSource}
                        onChange={(e) =>
                          updateLine(idx, {
                            priceSource: e.target.value as "SUPPLIER_PRICE_SNAPSHOT" | "MANUAL",
                          })
                        }
                        className="w-44 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                      >
                        <option value="SUPPLIER_PRICE_SNAPSHOT">供应商价目快照</option>
                        <option value="MANUAL">手工定价</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={line.unitPrice}
                        disabled={line.priceSource !== "MANUAL"}
                        onChange={(e) => updateLine(idx, { unitPrice: e.target.value })}
                        className="w-24 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none disabled:bg-slate-50"
                      />
                      {fieldErrors[`line-${idx}-unitPrice`] && (
                        <p className="mt-1 text-xs text-red-600">{fieldErrors[`line-${idx}-unitPrice`]}</p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={line.priceReason}
                        disabled={line.priceSource !== "MANUAL"}
                        onChange={(e) => updateLine(idx, { priceReason: e.target.value })}
                        className="w-36 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none disabled:bg-slate-50"
                      />
                      {fieldErrors[`line-${idx}-priceReason`] && (
                        <p className="mt-1 text-xs text-red-600">{fieldErrors[`line-${idx}-priceReason`]}</p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        disabled={lines.length <= 1}
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-3 text-xs text-red-700">
            {describeStatus(error.status)}：{error.message}
            {error.code ? `（${error.code}）` : ""}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "提交中…" : "创建（DRAFT）"}
          </button>
          {dirty && <span className="text-xs text-amber-600">有未保存的更改</span>}
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission="purchase-order:create">
      <PurchaseOrderCreateForm />
    </PermissionGuard>
  );
}
