"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";

interface PODetailLine {
  id: string;
  lineNo: number;
  description: string;
  quantity: string;
  unitPrice?: string | null;
  priceSource?: string | null;
  priceReason?: string | null;
  item?: { id: string | null; code: string | null; name: string | null } | null;
  uom?: { id: string | null; symbol: string | null } | null;
}

interface PODetail {
  id: string;
  version: number;
  status: string;
  supplierId: string;
  currency?: string | null;
  expectedDeliveryDate?: string | null;
  remark?: string | null;
  supplier?: { name: string | null } | null;
  lines?: PODetailLine[];
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

interface POEditLine {
  itemId: string;
  description: string;
  quantity: string;
  uomId: string;
  priceSource: "SUPPLIER_PRICE_SNAPSHOT" | "MANUAL";
  unitPrice: string;
  priceReason: string;
}

const emptyLine = (): POEditLine => ({
  itemId: "",
  description: "",
  quantity: "",
  uomId: "",
  priceSource: "SUPPLIER_PRICE_SNAPSHOT",
  unitPrice: "",
  priceReason: "",
});

function PurchaseOrderEditForm() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";

  const [detail, setDetail] = useState<PODetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [notEditable, setNotEditable] = useState(false);

  const [items, setItems] = useState<ItemOption[]>([]);
  const [uoms, setUoms] = useState<UomOption[]>([]);
  const [remark, setRemark] = useState("");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [lines, setLines] = useState<POEditLine[]>([]);
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // 数据源：FINAL read API（items / unit-of-measures）
  useEffect(() => {
    const controller = new AbortController();
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

  // 加载详情（Edit 回填 + version CAS 源）
  const loadDetail = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    apiFetch<PODetail>(`/api/purchase-orders/${id}`, { signal: controller.signal })
      .then((body) => {
        const d = body.data;
        setDetail(d);
        if (d.status !== "DRAFT") {
          setNotEditable(true);
          return;
        }
        setNotEditable(false);
        setVersion(d.version);
        setRemark(d.remark ?? "");
        setExpectedDeliveryDate(d.expectedDeliveryDate ?? "");
        setLines(
          (d.lines ?? []).map((l) => ({
            itemId: l.item?.id ?? "",
            description: l.description ?? "",
            quantity: l.quantity ?? "",
            uomId: l.uom?.id ?? "",
            priceSource: l.priceSource === "MANUAL" ? "MANUAL" : "SUPPLIER_PRICE_SNAPSHOT",
            unitPrice: l.unitPrice ?? "",
            priceReason: l.priceReason ?? "",
          })),
        );
        setDirty(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载失败", "NETWORK_ERROR"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id]);

  useEffect(() => loadDetail(), [loadDetail]);

  // Dirty state
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

  const updateLine = (idx: number, patch: Partial<POEditLine>) => {
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

  const validate = (): boolean => {
    const fe: Record<string, string> = {};
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
      await apiFetch<{ id: string }>(`/api/purchase-orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version,
          remark: remark.trim() || null,
          ...(expectedDeliveryDate ? { expectedDeliveryDate } : { expectedDeliveryDate: null }),
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
          changeReason: changeReason.trim(),
        }),
      });
      // Edit 成功收敛：重新加载 authoritative detail（保留最新 version 事实）
      await loadDetail();
      setChangeReason("");
      setError(null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
    } finally {
      setSubmitting(false);
    }
  };

  const isVersionConflict = error?.code === "VERSION_CONFLICT";

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 p-4">
        <h1 className="text-lg font-semibold text-slate-800">编辑采购订单（DRAFT）</h1>
        <Link
          href={`/purchasing/orders/${id}`}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          返回详情
        </Link>
      </div>

      {loading ? (
        <div className="p-6 text-sm text-slate-400">加载中…</div>
      ) : loadError ? (
        <div className="p-6">
          <p className="text-sm text-red-600">
            {describeStatus(loadError.status)}：{loadError.message}
            {loadError.code ? `（${loadError.code}）` : ""}
          </p>
          <Link href={`/purchasing/orders/${id}`} className="mt-2 inline-block text-sm text-brand-600">
            返回详情
          </Link>
        </div>
      ) : notEditable ? (
        <div className="p-6">
          <p className="text-sm text-amber-700">当前单据状态为 {detail?.status}，仅 DRAFT 可编辑。</p>
          <Link href={`/purchasing/orders/${id}`} className="mt-2 inline-block text-sm text-brand-600">
            返回详情
          </Link>
        </div>
      ) : detail ? (
        <div className="space-y-4 p-4">
          <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
            单号 {detail.code} · 供应商 {detail.supplier?.name ?? "—"} · 当前版本 v{detail.version}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            <div>
              <label className="text-xs font-medium text-slate-500">备注（可选）</label>
              <input
                value={remark}
                onChange={(e) => {
                  setRemark(e.target.value);
                  markDirty();
                }}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Lines（全量替换；supplierId/currency 服务端承诺事实锁定，禁改） */}
          <div className="rounded-md border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
              <p className="text-sm font-medium text-slate-700">订单行（全量替换）</p>
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

          <div>
            <label className="text-xs font-medium text-slate-500">变更原因</label>
            <input
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
              placeholder="本次修改原因（必填时由服务端校验）"
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>

          {error && (
            <div className="rounded-md bg-red-50 p-3 text-xs text-red-700">
              {describeStatus(error.status)}：{error.message}
              {error.code ? `（${error.code}）` : ""}
            </div>
          )}

          {/* 409 VERSION_CONFLICT：不自动 retry、不覆盖本地事实；提示 + 用户确认后重新载入 */}
          {isVersionConflict && (
            <div className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">
              数据已被他人修改（版本冲突）。当前未保存的更改不会被自动覆盖。若重新载入，未保存内容将丢失。
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("重新载入将丢弃当前未保存的更改，确定继续？")) {
                    loadDetail();
                    setError(null);
                  }
                }}
                className="ml-2 rounded-md border border-amber-300 px-2 py-1 text-amber-800 hover:bg-amber-100"
              >
                重新载入最新数据
              </button>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "保存中…" : "保存（DRAFT）"}
            </button>
            {dirty && <span className="text-xs text-amber-600">有未保存的更改</span>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission="purchase-order:edit">
      <PurchaseOrderEditForm />
    </PermissionGuard>
  );
}
