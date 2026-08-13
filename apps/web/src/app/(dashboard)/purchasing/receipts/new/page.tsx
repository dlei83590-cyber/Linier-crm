"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";

interface PurchaseOrderOption {
  id: string;
  code: string | null;
  status: string | null;
  supplier?: { name: string | null } | null;
}

interface PODetailLine {
  id: string;
  lineNo: number;
  quantity: string;
  remainingReceiveQty?: string | null;
  item?: { code: string | null; name: string | null; model: string | null } | null;
  uom?: { symbol: string | null } | null;
}

interface WarehouseOption {
  id: string;
  code: string | null;
  name: string | null;
}

interface ReceiptLine {
  purchaseOrderLineId: string;
  quantity: string;
  visibleDamageQty: string;
  rejectedOnReceiptQty: string;
  lineLabel: string;
}

function PurchaseReceiptCreateForm() {
  const router = useRouter();

  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [remark, setRemark] = useState("");
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // 数据源：FINAL read API（purchase-orders / warehouses，形态 A 兼容）
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<PurchaseOrderOption[] | { total: number; page: number; pageSize: number; items: PurchaseOrderOption[] }>(
      "/api/purchase-orders?pageSize=100",
      { signal: controller.signal },
    )
      .then((body) =>
        setPurchaseOrders(Array.isArray(body.data) ? body.data : (body.data.items ?? [])),
      )
      .catch(() => setPurchaseOrders([]));
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

  // 选择 PO → 加载 PO 详情 lines（溯源 purchaseOrderLineId）
  const loadPoLines = useCallback(
    (poId: string) => {
      const controller = new AbortController();
      setPurchaseOrderId(poId);
      setLines([]);
      if (!poId) return;
      apiFetch<{ lines?: PODetailLine[] }>(`/api/purchase-orders/${poId}`, {
        signal: controller.signal,
      })
        .then((body) => {
          const detailLines = body.data.lines ?? [];
          setLines(
            detailLines.map((l) => ({
              purchaseOrderLineId: l.id,
              quantity: l.remainingReceiveQty ?? l.quantity ?? "",
              visibleDamageQty: "0",
              rejectedOnReceiptQty: "0",
              lineLabel: `L${l.lineNo} ${l.item?.code ?? ""} ${l.item?.name ?? ""} (${l.uom?.symbol ?? ""})`,
            })),
          );
        })
        .catch(() => {
          setLines([]);
        });
      return () => controller.abort();
    },
    [],
  );

  const updateLine = (idx: number, patch: Partial<ReceiptLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    markDirty();
  };

  const validate = (): boolean => {
    const fe: Record<string, string> = {};
    if (!purchaseOrderId) fe.purchaseOrderId = "请选择采购订单";
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
      const body = await apiFetch<{ id: string }>("/api/purchase-receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchaseOrderId,
          ...(warehouseId ? { warehouseId } : {}),
          ...(remark.trim() ? { remark: remark.trim() } : {}),
          lines: lines.map((l) => ({
            purchaseOrderLineId: l.purchaseOrderLineId,
            quantity: Number(l.quantity),
            visibleDamageQty: Number(l.visibleDamageQty || 0),
            rejectedOnReceiptQty: Number(l.rejectedOnReceiptQty || 0),
          })),
        }),
      });
      // Success convergence：服务端返回 id 导航（权威）
      router.push(`/purchasing/receipts/${body.data.id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 p-4">
        <h1 className="text-lg font-semibold text-slate-800">新建到货收货（DRAFT）</h1>
        <Link
          href="/purchasing/receipts"
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          返回列表
        </Link>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <label className="text-xs font-medium text-slate-500">采购订单 *</label>
          <select
            value={purchaseOrderId}
            onChange={(e) => {
              loadPoLines(e.target.value);
              markDirty();
            }}
            className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          >
            <option value="">请选择采购订单</option>
            {purchaseOrders.map((po) => (
              <option key={po.id} value={po.id}>
                {po.code} · {po.supplier?.name ?? "—"}（{po.status ?? "—"}）
              </option>
            ))}
          </select>
          {fieldErrors.purchaseOrderId && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.purchaseOrderId}</p>
          )}
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

        {/* 收货行：来自 PO 详情（purchaseOrderLineId 溯源）；receivedQty/remainingReceiveQty 服务端回写禁客户端提交 */}
        <div className="rounded-md border border-slate-200">
          <div className="border-b border-slate-200 px-3 py-2">
            <p className="text-sm font-medium text-slate-700">收货行</p>
            {!purchaseOrderId && <p className="mt-1 text-xs text-slate-400">请先选择采购订单以加载行</p>}
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
                  <tr key={line.purchaseOrderLineId}>
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
    <PermissionGuard permission="purchase-receipt:create">
      <PurchaseReceiptCreateForm />
    </PermissionGuard>
  );
}
