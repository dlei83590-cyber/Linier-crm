"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";

interface ReceiptDetailLine {
  id: string;
  lineNo: number;
  quantity: string;
  visibleDamageQty?: string | null;
  rejectedOnReceiptQty?: string | null;
  item?: { code: string | null; name: string | null; model: string | null } | null;
  uom?: { symbol: string | null } | null;
}

interface ReceiptDetail {
  id: string;
  code: string;
  version: number;
  status: string;
  remark?: string | null;
  warehouseId?: string | null;
  warehouse?: { name: string | null } | null;
  purchaseOrder?: { code: string | null } | null;
  supplier?: { name: string | null } | null;
  lines?: ReceiptDetailLine[];
}

interface WarehouseOption {
  id: string;
  code: string | null;
  name: string | null;
}

interface ReceiptEditLine {
  id: string;
  quantity: string;
  visibleDamageQty: string;
  rejectedOnReceiptQty: string;
  lineLabel: string;
}

function PurchaseReceiptEditForm() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";

  const [detail, setDetail] = useState<ReceiptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [notEditable, setNotEditable] = useState(false);

  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [remark, setRemark] = useState("");
  const [lines, setLines] = useState<ReceiptEditLine[]>([]);
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
    apiFetch<ReceiptDetail>(`/api/purchase-receipts/${id}`, { signal: controller.signal })
      .then((body) => {
        const d = body.data;
        setDetail(d);
        if (d.status !== "DRAFT") {
          setNotEditable(true);
          return;
        }
        setNotEditable(false);
        setVersion(d.version);
        setWarehouseId(d.warehouseId ?? "");
        setRemark(d.remark ?? "");
        setLines(
          (d.lines ?? []).map((l) => ({
            id: l.id,
            quantity: l.quantity ?? "",
            visibleDamageQty: l.visibleDamageQty ?? "0",
            rejectedOnReceiptQty: l.rejectedOnReceiptQty ?? "0",
            lineLabel: `L${l.lineNo} ${l.item?.code ?? ""} ${l.item?.name ?? ""} (${l.uom?.symbol ?? ""})`,
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

  const updateLine = (idx: number, patch: Partial<ReceiptEditLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    markDirty();
  };

  const validate = (): boolean => {
    const fe: Record<string, string> = {};
    lines.forEach((l, idx) => {
      const qty = Number(l.quantity);
      if (!l.quantity || !Number.isFinite(qty) || qty <= 0) {
        fe[`line-${idx}-quantity`] = "收货数量必须 > 0";
      }
      const rejected = Number(l.rejectedOnReceiptQty || 0);
      const visible = Number(l.visibleDamageQty || 0);
      if (!Number.isFinite(rejected) || rejected < 0) {
        fe[`line-${idx}-rejected`] = "现场拒收数量不能为负";
      }
      if (!Number.isFinite(visible) || visible < 0) {
        fe[`line-${idx}-visible`] = "可见损坏数量不能为负";
      }
      if (rejected > qty) {
        fe[`line-${idx}-rejected`] = "现场拒收数量不能超过收货数量";
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
      await apiFetch<{ id: string }>(`/api/purchase-receipts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version,
          warehouseId: warehouseId || null,
          remark: remark.trim() || null,
          lines: lines.map((l) => ({
            purchaseOrderLineId: l.id,
            quantity: Number(l.quantity),
            visibleDamageQty: Number(l.visibleDamageQty || 0),
            rejectedOnReceiptQty: Number(l.rejectedOnReceiptQty || 0),
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
        <h1 className="text-lg font-semibold text-slate-800">编辑到货收货（DRAFT）</h1>
        <Link
          href={`/purchasing/receipts/${id}`}
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
          <Link href={`/purchasing/receipts/${id}`} className="mt-2 inline-block text-sm text-brand-600">
            返回详情
          </Link>
        </div>
      ) : notEditable ? (
        <div className="p-6">
          <p className="text-sm text-amber-700">当前单据状态为 {detail?.status}，仅 DRAFT 可编辑。</p>
          <Link href={`/purchasing/receipts/${id}`} className="mt-2 inline-block text-sm text-brand-600">
            返回详情
          </Link>
        </div>
      ) : detail ? (
        <div className="space-y-4 p-4">
          <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
            单号 {detail.code} · PO {detail.purchaseOrder?.code ?? "—"} · 供应商 {detail.supplier?.name ?? "—"} ·
            当前版本 v{detail.version}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-slate-500">收货仓库（可选，仅 WAREHOUSE 场景）</label>
              <select
                value={warehouseId}
                onChange={(e) => {
                  setWarehouseId(e.target.value);
                  markDirty();
                }}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              >
                <option value="">不指定仓库</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} · {w.name}
                  </option>
                ))}
              </select>
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

          {/* 收货行全量替换；receivedQty/remainingReceiveQty 服务端回写禁客户端提交 */}
          <div className="rounded-md border border-slate-200">
            <div className="border-b border-slate-200 px-3 py-2">
              <p className="text-sm font-medium text-slate-700">收货行（全量替换）</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-3 py-2">PO 行（溯源）</th>
                    <th className="px-3 py-2">收货数量 *</th>
                    <th className="px-3 py-2">可见损坏</th>
                    <th className="px-3 py-2">现场拒收</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((line, idx) => (
                    <tr key={line.id}>
                      <td className="px-3 py-2 text-slate-700">{line.lineLabel}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={line.quantity}
                          onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                          className="w-28 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                        />
                        {fieldErrors[`line-${idx}-quantity`] && (
                          <p className="mt-1 text-xs text-red-600">{fieldErrors[`line-${idx}-quantity`]}</p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={line.visibleDamageQty}
                          onChange={(e) => updateLine(idx, { visibleDamageQty: e.target.value })}
                          className="w-24 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                        />
                        {fieldErrors[`line-${idx}-visible`] && (
                          <p className="mt-1 text-xs text-red-600">{fieldErrors[`line-${idx}-visible`]}</p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={line.rejectedOnReceiptQty}
                          onChange={(e) => updateLine(idx, { rejectedOnReceiptQty: e.target.value })}
                          className="w-24 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                        />
                        {fieldErrors[`line-${idx}-rejected`] && (
                          <p className="mt-1 text-xs text-red-600">{fieldErrors[`line-${idx}-rejected`]}</p>
                        )}
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
    <PermissionGuard permission="purchase-receipt:edit">
      <PurchaseReceiptEditForm />
    </PermissionGuard>
  );
}
