"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";

interface WhrDetailLine {
  id: string;
  quantity: string;
  batchNo?: string | null;
  serialNos?: string[] | null;
  mfgDate?: string | null;
  expDate?: string | null;
  item?: { code: string | null; name: string | null; model: string | null } | null;
  uom?: { symbol: string | null } | null;
  purchaseReceiptLine?: { id: string | null; lineNo: number | null } | null;
  inspection?: { id: string | null; inspectionMode: string | null; result: string | null; qualifiedQty: string | null } | null;
}

interface WhrDetail {
  id: string;
  code: string;
  version: number;
  status: string;
  remark?: string | null;
  warehouseId: string;
  locationId?: string | null;
  warehouse?: { name: string | null } | null;
  location?: { name: string | null } | null;
  purchaseReceipt?: { code: string | null } | null;
  lines?: WhrDetailLine[];
}

interface WarehouseOption {
  id: string;
  code: string | null;
  name: string | null;
}

interface WarehouseLocationOption {
  id: string;
  code: string | null;
  name: string | null;
}

interface InspectionOption {
  id: string;
  inspectionMode: string | null;
  result: string | null;
  qualifiedQty?: string | null;
}

interface WhrEditLine {
  purchaseReceiptLineId: string;
  lineLabel: string;
  inspectionId: string;
  quantity: string;
  batchNo: string;
  serialNos: string;
  mfgDate: string;
  expDate: string;
}

function WarehouseReceiptEditForm() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";

  const [detail, setDetail] = useState<WhrDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [notEditable, setNotEditable] = useState(false);

  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [locations, setLocations] = useState<WarehouseLocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [remark, setRemark] = useState("");
  const [inspectionMap, setInspectionMap] = useState<Record<string, InspectionOption[]>>({});
  const [lines, setLines] = useState<WhrEditLine[]>([]);
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // 数据源：FINAL read API（warehouses）
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<WarehouseOption[] | { total: number; page: number; pageSize: number; items: WarehouseOption[] }>(
      "/api/warehouses?pageSize=100",
      { signal: controller.signal },
    )
      .then((body) => setWarehouses(Array.isArray(body.data) ? body.data : (body.data.items ?? [])))
      .catch(() => setWarehouses([]));
    return () => controller.abort();
  }, []);

  // 加载详情（Edit 回填 + version CAS 源）
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
          return;
        }
        setNotEditable(false);
        setVersion(d.version);
        setWarehouseId(d.warehouseId);
        setLocationId(d.locationId ?? "");
        setRemark(d.remark ?? "");
        setLines(
          (d.lines ?? []).map((l) => ({
            purchaseReceiptLineId: l.purchaseReceiptLine?.id ?? l.id,
            lineLabel: `${l.item?.code ?? ""} ${l.item?.name ?? ""} (${l.uom?.symbol ?? ""})`,
            inspectionId: l.inspection?.id ?? "",
            quantity: l.quantity ?? "",
            batchNo: l.batchNo ?? "",
            serialNos: (l.serialNos ?? []).join(","),
            mfgDate: l.mfgDate ?? "",
            expDate: l.expDate ?? "",
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

  // 加载仓库 locations（dependent selector 数据源）
  const loadLocations = useCallback((wid: string) => {
    if (!wid) {
      setLocations([]);
      return;
    }
    const controller = new AbortController();
    apiFetch<
      WarehouseLocationOption[] | { total: number; page: number; pageSize: number; items: WarehouseLocationOption[] }
    >(`/api/warehouse-locations?warehouseId=${encodeURIComponent(wid)}&pageSize=100`, {
      signal: controller.signal,
    })
      .then((body) => setLocations(Array.isArray(body.data) ? body.data : (body.data.items ?? [])))
      .catch(() => setLocations([]));
    return () => controller.abort();
  }, []);

  // 初始加载后按回填的 warehouseId 拉取 locations
  useEffect(() => {
    if (!warehouseId || loading) return;
    loadLocations(warehouseId);
  }, [warehouseId, loading, loadLocations]);

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

  // Warehouse change → 清空 locationId + 重新加载该仓 locations（dependent selector，禁 stale 组合）
  const handleWarehouseChange = (wid: string) => {
    setWarehouseId(wid);
    setLocationId("");
    setLocations([]);
    if (wid) loadLocations(wid);
    markDirty();
  };

  // 加载某收货行的 inspections（已验收且 qualifiedQty>0 的可入库）
  const loadInspections = useCallback((receiptLineId: string) => {
    const controller = new AbortController();
    apiFetch<InspectionOption[] | { total: number; page: number; pageSize: number; items: InspectionOption[] }>(
      `/api/inspections?purchaseReceiptLineId=${encodeURIComponent(receiptLineId)}&pageSize=100`,
      { signal: controller.signal },
    )
      .then((body) => {
        const list = Array.isArray(body.data) ? body.data : (body.data.items ?? []);
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

  const updateLine = (idx: number, patch: Partial<WhrEditLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    markDirty();
  };

  const validate = (): boolean => {
    const fe: Record<string, string> = {};
    if (!warehouseId) fe.warehouseId = "请选择入库仓库";
    lines.forEach((l, idx) => {
      if (!l.inspectionId) fe[`line-${idx}-inspectionId`] = "请选择质检结论";
      const qty = Number(l.quantity);
      if (!l.quantity || !Number.isFinite(qty) || qty <= 0) fe[`line-${idx}-quantity`] = "入库数量必须 > 0";
    });
    setFieldErrors(fe);
    return Object.keys(fe).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch<{ id: string }>(`/api/warehouse-receipts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version,
          warehouseId,
          locationId: locationId || null,
          remark: remark.trim() || null,
          lines: lines.map((l) => ({
            purchaseReceiptLineId: l.purchaseReceiptLineId,
            inspectionId: l.inspectionId,
            quantity: Number(l.quantity),
            ...(l.batchNo.trim() ? { batchNo: l.batchNo.trim() } : {}),
            ...(l.serialNos.trim()
              ? { serialNos: l.serialNos.split(",").map((s) => s.trim()).filter(Boolean) }
              : {}),
            ...(l.mfgDate ? { mfgDate: l.mfgDate } : {}),
            ...(l.expDate ? { expDate: l.expDate } : {}),
          })),
        }),
      });
      // Edit 成功收敛：重新加载 authoritative detail（保留最新 version 事实）
      await loadDetail();
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
        <h1 className="text-lg font-semibold text-slate-800">编辑仓库收货（DRAFT）</h1>
        <Link
          href={`/purchasing/warehouse-receipts/${id}`}
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
          <Link href={`/purchasing/warehouse-receipts/${id}`} className="mt-2 inline-block text-sm text-brand-600">
            返回详情
          </Link>
        </div>
      ) : notEditable ? (
        <div className="p-6">
          <p className="text-sm text-amber-700">当前单据状态为 {detail?.status}，仅 DRAFT 可编辑。</p>
          <Link href={`/purchasing/warehouse-receipts/${id}`} className="mt-2 inline-block text-sm text-brand-600">
            返回详情
          </Link>
        </div>
      ) : detail ? (
        <div className="space-y-4 p-4">
          <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
            单号 {detail.code} · 收货单 {detail.purchaseReceipt?.code ?? "—"} · 当前版本 v{detail.version}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-slate-500">入库仓库 *</label>
              <select
                value={warehouseId}
                onChange={(e) => handleWarehouseChange(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              >
                <option value="">请选择仓库</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} · {w.name}
                  </option>
                ))}
              </select>
              {fieldErrors.warehouseId && <p className="mt-1 text-xs text-red-600">{fieldErrors.warehouseId}</p>}
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">库位（可选，属于所选仓库）</label>
              <select
                value={locationId}
                onChange={(e) => {
                  setLocationId(e.target.value);
                  markDirty();
                }}
                disabled={!warehouseId}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none disabled:bg-slate-50"
              >
                <option value="">不指定库位</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.code} · {loc.name}
                  </option>
                ))}
              </select>
              {warehouseId && locations.length === 0 && (
                <p className="mt-1 text-xs text-slate-400">该仓库暂无库位</p>
              )}
            </div>
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

          {/* 入库行全量替换；purchaseReceiptLineId + inspectionId 组合 FK（服务端校验同属/qualifiedQty>0/≤可入库余额） */}
          <div className="rounded-md border border-slate-200">
            <div className="border-b border-slate-200 px-3 py-2">
              <p className="text-sm font-medium text-slate-700">入库行（全量替换）</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-3 py-2">收货行（溯源）</th>
                    <th className="px-3 py-2">质检结论 *</th>
                    <th className="px-3 py-2">入库数量 *</th>
                    <th className="px-3 py-2">批次号</th>
                    <th className="px-3 py-2">序列号（逗号分隔）</th>
                    <th className="px-3 py-2">生产日期</th>
                    <th className="px-3 py-2">有效期至</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((line, idx) => (
                    <tr key={line.purchaseReceiptLineId}>
                      <td className="px-3 py-2 text-slate-700">
                        {line.lineLabel}
                        <button
                          type="button"
                          onClick={() => loadInspections(line.purchaseReceiptLineId)}
                          className="ml-2 rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-50"
                        >
                          加载质检
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={line.inspectionId}
                          onChange={(e) => updateLine(idx, { inspectionId: e.target.value })}
                          className="w-44 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                        >
                          <option value="">选择质检</option>
                          {(inspectionMap[line.purchaseReceiptLineId] ?? []).map((ins) => (
                            <option key={ins.id} value={ins.id}>
                              {ins.inspectionMode ?? "—"} · {ins.result ?? "—"} · 合格 {ins.qualifiedQty ?? "—"}
                            </option>
                          ))}
                        </select>
                        {fieldErrors[`line-${idx}-inspectionId`] && (
                          <p className="mt-1 text-xs text-red-600">{fieldErrors[`line-${idx}-inspectionId`]}</p>
                        )}
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
                        <input
                          value={line.batchNo}
                          onChange={(e) => updateLine(idx, { batchNo: e.target.value })}
                          className="w-24 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={line.serialNos}
                          onChange={(e) => updateLine(idx, { serialNos: e.target.value })}
                          className="w-32 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={line.mfgDate}
                          onChange={(e) => updateLine(idx, { mfgDate: e.target.value })}
                          className="w-32 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={line.expDate}
                          onChange={(e) => updateLine(idx, { expDate: e.target.value })}
                          className="w-32 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                        />
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
    <PermissionGuard permission="warehouse-receipt:edit">
      <WarehouseReceiptEditForm />
    </PermissionGuard>
  );
}
