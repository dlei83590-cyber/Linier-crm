"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";

interface PurchaseReceiptOption {
  id: string;
  code: string | null;
  status: string | null;
  purchaseOrder?: { code: string | null } | null;
  supplier?: { name: string | null } | null;
}

interface ReceiptDetailLine {
  id: string;
  lineNo: number;
  quantity: string;
  item?: { code: string | null; name: string | null; model: string | null } | null;
  uom?: { symbol: string | null } | null;
}

interface InspectionOption {
  id: string;
  inspectionMode: string | null;
  result: string | null;
  qualifiedQty?: string | null;
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

interface WhrLine {
  purchaseReceiptLineId: string;
  lineLabel: string;
  inspectionId: string;
  quantity: string;
  batchNo: string;
  serialNos: string;
  mfgDate: string;
  expDate: string;
}

function WarehouseReceiptCreateForm() {
  const router = useRouter();

  const [purchaseReceipts, setPurchaseReceipts] = useState<PurchaseReceiptOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [purchaseReceiptId, setPurchaseReceiptId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [locations, setLocations] = useState<WarehouseLocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [remark, setRemark] = useState("");
  const [receiptLines, setReceiptLines] = useState<ReceiptDetailLine[]>([]);
  const [inspectionMap, setInspectionMap] = useState<Record<string, InspectionOption[]>>({});
  const [lines, setLines] = useState<WhrLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // 数据源：FINAL read API（purchase-receipts / warehouses）
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<
      PurchaseReceiptOption[] | { total: number; page: number; pageSize: number; items: PurchaseReceiptOption[] }
    >("/api/purchase-receipts?pageSize=100", { signal: controller.signal })
      .then((body) => setPurchaseReceipts(Array.isArray(body.data) ? body.data : (body.data.items ?? [])))
      .catch(() => setPurchaseReceipts([]));
    apiFetch<WarehouseOption[] | { total: number; page: number; pageSize: number; items: WarehouseOption[] }>(
      "/api/warehouses?pageSize=100",
      { signal: controller.signal },
    )
      .then((body) => setWarehouses(Array.isArray(body.data) ? body.data : (body.data.items ?? [])))
      .catch(() => setWarehouses([]));
    return () => controller.abort();
  }, []);

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

  // 选择 Receipt → 加载收货行（purchaseReceiptLineId 溯源）
  const loadReceiptLines = useCallback(
    (receiptId: string) => {
      const controller = new AbortController();
      setPurchaseReceiptId(receiptId);
      setReceiptLines([]);
      setInspectionMap({});
      setLines([]);
      if (!receiptId) return;
      apiFetch<{ lines?: ReceiptDetailLine[] }>(`/api/purchase-receipts/${receiptId}`, {
        signal: controller.signal,
      })
        .then((body) => {
          const detailLines = body.data.lines ?? [];
          setReceiptLines(detailLines);
          setLines(
            detailLines.map((l) => ({
              purchaseReceiptLineId: l.id,
              lineLabel: `L${l.lineNo} ${l.item?.code ?? ""} ${l.item?.name ?? ""} (${l.uom?.symbol ?? ""})`,
              inspectionId: "",
              quantity: l.quantity ?? "",
              batchNo: "",
              serialNos: "",
              mfgDate: "",
              expDate: "",
            })),
          );
        })
        .catch(() => {
          setReceiptLines([]);
          setLines([]);
        });
      return () => controller.abort();
    },
    [],
  );

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

  // Warehouse change → 清空 locationId + 重新加载该仓的 locations（dependent selector）
  const handleWarehouseChange = (wid: string) => {
    setWarehouseId(wid);
    setLocationId("");
    setLocations([]);
    if (!wid) return;
    const controller = new AbortController();
    apiFetch<
      WarehouseLocationOption[] | { total: number; page: number; pageSize: number; items: WarehouseLocationOption[] }
    >(`/api/warehouse-locations?warehouseId=${encodeURIComponent(wid)}&pageSize=100`, {
      signal: controller.signal,
    })
      .then((body) => setLocations(Array.isArray(body.data) ? body.data : (body.data.items ?? [])))
      .catch(() => setLocations([]));
    markDirty();
  };

  const updateLine = (idx: number, patch: Partial<WhrLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    markDirty();
  };

  const validate = (): boolean => {
    const fe: Record<string, string> = {};
    if (!purchaseReceiptId) fe.purchaseReceiptId = "请选择到货收货单";
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
      const body = await apiFetch<{ id: string }>("/api/warehouse-receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
            ...(l.serialNos.trim()
              ? { serialNos: l.serialNos.split(",").map((s) => s.trim()).filter(Boolean) }
              : {}),
            ...(l.mfgDate ? { mfgDate: l.mfgDate } : {}),
            ...(l.expDate ? { expDate: l.expDate } : {}),
          })),
        }),
      });
      // Success convergence：服务端返回 id 导航（权威）
      router.push(`/purchasing/warehouse-receipts/${body.data.id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 p-4">
        <h1 className="text-lg font-semibold text-slate-800">新建仓库收货（DRAFT）</h1>
        <Link
          href="/purchasing/warehouse-receipts"
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          返回列表
        </Link>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <label className="text-xs font-medium text-slate-500">到货收货单 *</label>
          <select
            value={purchaseReceiptId}
            onChange={(e) => {
              loadReceiptLines(e.target.value);
              markDirty();
            }}
            className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          >
            <option value="">请选择到货收货单</option>
            {purchaseReceipts.map((r) => (
              <option key={r.id} value={r.id}>
                {r.code} · {r.supplier?.name ?? "—"}（{r.status ?? "—"}）
              </option>
            ))}
          </select>
          {fieldErrors.purchaseReceiptId && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.purchaseReceiptId}</p>
          )}
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

        {/* 入库行：purchaseReceiptLineId + inspectionId 组合 FK（服务端校验同属/已完成/qualifiedQty>0/≤可入库余额） */}
        <div className="rounded-md border border-slate-200">
          <div className="border-b border-slate-200 px-3 py-2">
            <p className="text-sm font-medium text-slate-700">入库行</p>
            {!purchaseReceiptId && <p className="mt-1 text-xs text-slate-400">请先选择到货收货单以加载行</p>}
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

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || lines.length === 0}
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
    <PermissionGuard permission="warehouse-receipt:create">
      <WarehouseReceiptCreateForm />
    </PermissionGuard>
  );
}
