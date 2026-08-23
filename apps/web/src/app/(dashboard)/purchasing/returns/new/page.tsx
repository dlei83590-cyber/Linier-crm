"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS, CARD_CLASS } from "@/lib/ui-classes";

interface PurchaseOrderOption {
  id: string;
  code: string | null;
  status: string | null;
  supplier?: { name: string | null } | null;
}

const RETURN_TYPES = ["REJECTED_ON_RECEIPT", "RETURN_AFTER_STOCK_IN", "QUALITY_ISSUE"] as const;
const SOURCE_REF_TYPES = ["RECEIPT_LINE", "WAREHOUSE_RECEIPT_LINE", "INSPECTION"] as const;
const DISPOSITIONS = ["REPLACE_REQUIRED", "CREDIT_ONLY"] as const;

interface ReturnLineForm {
  sourceRefType: string;
  /** 来源单据 id（按单拉取退货信息：选择单据 → 拉取该单据可退行） */
  sourceDocId: string;
  sourceDocLines: SourceLineOption[];
  docLoading: boolean;
  sourcePurchaseReceiptLineId: string;
  sourceWarehouseReceiptLineId: string;
  sourceInspectionId: string;
  quantity: string;
  disposition: string;
  returnReason: string;
  batchNo: string;
  serialNos: string;
  remark: string;
}

interface SourceDocOption {
  id: string;
  code: string | null;
  status?: string | null;
}

interface SourceLineOption {
  id: string;
  label: string;
}

const EMPTY_LINE: ReturnLineForm = {
  sourceRefType: "RECEIPT_LINE",
  sourceDocId: "",
  sourceDocLines: [],
  docLoading: false,
  sourcePurchaseReceiptLineId: "",
  sourceWarehouseReceiptLineId: "",
  sourceInspectionId: "",
  quantity: "",
  disposition: "REPLACE_REQUIRED",
  returnReason: "",
  batchNo: "",
  serialNos: "",
  remark: "",
};

function PurchaseReturnCreateForm() {
  const router = useRouter();
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderOption[]>([]);
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [returnType, setReturnType] = useState("REJECTED_ON_RECEIPT");
  const [remark, setRemark] = useState("");
  const [lines, setLines] = useState<ReturnLineForm[]>([{ ...EMPTY_LINE }]);
  // 按单拉取：来源单据列表缓存（按 sourceRefType）
  const [docMap, setDocMap] = useState<Record<string, SourceDocOption[]>>({});
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // 数据源：PO 下拉（GET /api/purchase-orders FINAL read API）；来源行 = 父单据详情 ID（见 CONTRACT GAP 标注）
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<PurchaseOrderOption[] | { total: number; page: number; pageSize: number; items: PurchaseOrderOption[] }>(
      "/api/purchase-orders?pageSize=100",
      { signal: controller.signal },
    )
      .then((body) => setPurchaseOrders(Array.isArray(body.data) ? body.data : (body.data.items ?? [])))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载采购订单失败", "NETWORK_ERROR"));
      });
    return () => controller.abort();
  }, []);

  // Dirty state：未保存离开提示
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

  const updateLine = (idx: number, patch: Partial<ReturnLineForm>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    markDirty();
  };

  /** 按来源类型加载单据列表（按单拉取退货信息；收货单按 PO 过滤，入库/质检全量） */
  const loadDocs = (refType: string) => {
    if (docMap[refType] !== undefined) return; // 已缓存
    let url = "";
    if (refType === "RECEIPT_LINE") {
      url = purchaseOrderId
        ? `/api/purchase-receipts?pageSize=100&purchaseOrderId=${encodeURIComponent(purchaseOrderId)}`
        : "/api/purchase-receipts?pageSize=100";
    } else if (refType === "WAREHOUSE_RECEIPT_LINE") {
      url = "/api/warehouse-receipts?pageSize=100";
    } else {
      url = "/api/inspections?pageSize=100";
    }
    apiFetch<SourceDocOption[] | { total: number; page: number; pageSize: number; items: SourceDocOption[] }>(url)
      .then((body) => {
        const arr = Array.isArray(body.data) ? body.data : (body.data?.items ?? []);
        setDocMap((prev) => ({ ...prev, [refType]: arr }));
      })
      .catch(() => setDocMap((prev) => ({ ...prev, [refType]: [] })));
  };

  /** 选择来源单据 → 拉取该单据可退行（按单拉取退货信息） */
  const loadDocLines = (idx: number, docId: string, refType: string) => {
    updateLine(idx, { sourceDocId: docId, sourceDocLines: [], docLoading: true });
    if (!docId) {
      updateLine(idx, { docLoading: false });
      return;
    }
    if (refType === "RECEIPT_LINE") {
      apiFetch<{ lines?: Array<{ id: string; lineNo: number; quantity: string; item?: { code: string | null; name: string | null } | null; uom?: { symbol: string | null } | null }> }>(
        `/api/purchase-receipts/${docId}`,
      )
        .then((body) => {
          const rows = (body.data.lines ?? []).map((l) => ({
            id: l.id,
            label: `L${l.lineNo} ${l.item?.code ?? ""} ${l.item?.name ?? ""}（数量 ${l.quantity}${l.uom?.symbol ? ` ${l.uom.symbol}` : ""}）`.trim(),
          }));
          updateLine(idx, { sourceDocLines: rows, docLoading: false, sourcePurchaseReceiptLineId: "" });
        })
        .catch(() => updateLine(idx, { sourceDocLines: [], docLoading: false }));
    } else if (refType === "WAREHOUSE_RECEIPT_LINE") {
      apiFetch<{ lines?: Array<{ id: string; lineNo: number; quantity: string; item?: { code: string | null; name: string | null } | null; uom?: { symbol: string | null } | null }> }>(
        `/api/warehouse-receipts/${docId}`,
      )
        .then((body) => {
          const rows = (body.data.lines ?? []).map((l) => ({
            id: l.id,
            label: `L${l.lineNo} ${l.item?.code ?? ""} ${l.item?.name ?? ""}（数量 ${l.quantity}${l.uom?.symbol ? ` ${l.uom.symbol}` : ""}）`.trim(),
          }));
          updateLine(idx, { sourceDocLines: rows, docLoading: false, sourceWarehouseReceiptLineId: "" });
        })
        .catch(() => updateLine(idx, { sourceDocLines: [], docLoading: false }));
    } else {
      // INSPECTION：质检记录本身即行级候选（选中即填 sourceInspectionId）
      apiFetch<{
        result?: string;
        qualifiedQty?: string;
        inspectionMode?: string;
        purchaseReceiptLine?: { lineNo: number; quantity: string; item?: { code: string | null; name: string | null } | null } | null;
      }>(`/api/inspections/${docId}`)
        .then((body) => {
          const d = body.data;
          const rows = [{
            id: docId,
            label: `质检 ${d.inspectionMode ?? ""} ${d.result ?? ""}（合格 ${d.qualifiedQty ?? 0}）${d.purchaseReceiptLine?.item ? ` ${d.purchaseReceiptLine.item.code ?? ""} ${d.purchaseReceiptLine.item.name ?? ""}`.trim() : ""}`.trim(),
          }];
          updateLine(idx, { sourceDocLines: rows, docLoading: false, sourceInspectionId: "" });
        })
        .catch(() => updateLine(idx, { sourceDocLines: [], docLoading: false }));
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
    if (!purchaseOrderId) errs.purchaseOrderId = "请选择采购订单";
    lines.forEach((l, i) => {
      const srcKey = `lines.${i}.source`;
      if (l.sourceRefType === "RECEIPT_LINE" && !l.sourcePurchaseReceiptLineId) {
        errs[srcKey] = "RECEIPT_LINE 必须提供 sourcePurchaseReceiptLineId";
      } else if (l.sourceRefType === "WAREHOUSE_RECEIPT_LINE" && !l.sourceWarehouseReceiptLineId) {
        errs[srcKey] = "WAREHOUSE_RECEIPT_LINE 必须提供 sourceWarehouseReceiptLineId";
      } else if (l.sourceRefType === "INSPECTION" && !l.sourceInspectionId) {
        errs[srcKey] = "INSPECTION 必须提供 sourceInspectionId";
      }
      if (!l.quantity || Number(l.quantity) <= 0) errs[`lines.${i}.quantity`] = "数量必须大于 0";
      if (!l.returnReason.trim()) errs[`lines.${i}.returnReason`] = "退货原因必填";
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
        purchaseOrderId,
        returnType,
        ...(remark ? { remark } : {}),
        lines: lines.map((l) => {
          const base: Record<string, unknown> = {
            sourceRefType: l.sourceRefType,
            quantity: Number(l.quantity),
            disposition: l.disposition,
            returnReason: l.returnReason,
            ...(l.batchNo ? { batchNo: l.batchNo } : {}),
            ...(l.serialNos
              ? { serialNos: l.serialNos.split(/[,，\s]+/).filter(Boolean) }
              : {}),
            ...(l.remark ? { remark: l.remark } : {}),
          };
          if (l.sourceRefType === "RECEIPT_LINE") base.sourcePurchaseReceiptLineId = l.sourcePurchaseReceiptLineId;
          if (l.sourceRefType === "WAREHOUSE_RECEIPT_LINE")
            base.sourceWarehouseReceiptLineId = l.sourceWarehouseReceiptLineId;
          if (l.sourceRefType === "INSPECTION") base.sourceInspectionId = l.sourceInspectionId;
          return base;
        }),
      };
      const body = await apiFetch<{ id: string }>("/api/purchase-returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setDirty(false);
      // Success convergence：服务端返回 id 导航详情（权威 re-GET）
      router.push(`/purchasing/returns/${body.data.id}`);
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err : new ApiClientError(0, "创建失败", "NETWORK_ERROR"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center justify-between border-b border-border p-4">
        <h1 className="text-lg font-semibold text-ink-primary">新建采购退货</h1>
        <Link
          href="/purchasing/returns"
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
            <label className="block text-xs text-ink-secondary">采购订单（必填）</label>
            <select
              value={purchaseOrderId}
              onChange={(e) => {
                setPurchaseOrderId(e.target.value);
                markDirty();
              }}
              className="mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:border-brand-500 focus:outline-none"
            >
              <option value="">选择采购订单</option>
              {purchaseOrders.map((po) => (
                <option key={po.id} value={po.id}>
                  {po.code ?? ""}（{po.status ?? ""}）{po.supplier?.name ? ` / ${po.supplier.name}` : ""}
                </option>
              ))}
            </select>
            {fieldErrors.purchaseOrderId && (
              <p className="mt-0.5 text-xs text-status-danger-text">{fieldErrors.purchaseOrderId}</p>
            )}
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">退货类型（必填）</label>
            <select
              value={returnType}
              onChange={(e) => {
                setReturnType(e.target.value);
                markDirty();
              }}
              className="mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:border-brand-500 focus:outline-none"
            >
              {RETURN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-ink-secondary">备注（可选，≤500）</label>
            <textarea
              value={remark}
              onChange={(e) => {
                setRemark(e.target.value);
                markDirty();
              }}
              rows={2}
              className="mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:border-brand-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink-secondary">退货明细（至少一行）</h2>
          <button
            type="button"
            onClick={addLine}
            className={BUTTON_PRIMARY_CLASS}
          >
            + 添加行
          </button>
        </div>
        {fieldErrors.lines && <p className="mb-2 text-xs text-status-danger-text">{fieldErrors.lines}</p>}

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
              <tr>
                <th className="px-3 py-2">来源类型</th>
                <th className="px-3 py-2">来源单据 / 来源行（按单拉取）</th>
                <th className="px-3 py-2">数量</th>
                <th className="px-3 py-2">处置</th>
                <th className="px-3 py-2">退货原因</th>
                <th className="px-3 py-2">批次/序列号</th>
                <th className="px-3 py-2">备注</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((line, idx) => (
                <tr key={idx}>
                  <td className="px-3 py-2">
                    <select
                      value={line.sourceRefType}
                      onChange={(e) =>
                        updateLine(idx, {
                          sourceRefType: e.target.value,
                          sourceDocId: "",
                          sourceDocLines: [],
                          sourcePurchaseReceiptLineId: "",
                          sourceWarehouseReceiptLineId: "",
                          sourceInspectionId: "",
                        })
                      }
                      className="w-full rounded-md border border-border px-2 py-1.5 focus:border-brand-500 focus:outline-none"
                    >
                      {SOURCE_REF_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <div className="space-y-1">
                      <select
                        value={line.sourceDocId}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (docMap[line.sourceRefType] === undefined) loadDocs(line.sourceRefType);
                          loadDocLines(idx, v, line.sourceRefType);
                        }}
                        className="w-full rounded-md border border-border px-2 py-1.5 focus:border-brand-500 focus:outline-none"
                      >
                        <option value="">选择来源单据</option>
                        {(docMap[line.sourceRefType] ?? []).map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.code ?? d.id}（{d.status ?? ""}）
                          </option>
                        ))}
                      </select>
                      <select
                        value={
                          line.sourceRefType === "RECEIPT_LINE"
                            ? line.sourcePurchaseReceiptLineId
                            : line.sourceRefType === "WAREHOUSE_RECEIPT_LINE"
                              ? line.sourceWarehouseReceiptLineId
                              : line.sourceInspectionId
                        }
                        onChange={(e) => {
                          const v = e.target.value;
                          const patch: Partial<ReturnLineForm> = {};
                          if (line.sourceRefType === "RECEIPT_LINE") patch.sourcePurchaseReceiptLineId = v;
                          else if (line.sourceRefType === "WAREHOUSE_RECEIPT_LINE") patch.sourceWarehouseReceiptLineId = v;
                          else patch.sourceInspectionId = v;
                          updateLine(idx, patch);
                        }}
                        className="w-full rounded-md border border-border px-2 py-1.5 focus:border-brand-500 focus:outline-none"
                      >
                        <option value="">选择来源行</option>
                        {line.sourceDocLines.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      {line.docLoading && <p className="text-xs text-ink-muted">加载中…</p>}
                      {fieldErrors[`lines.${idx}.source`] && (
                        <p className="mt-0.5 text-xs text-status-danger-text">{fieldErrors[`lines.${idx}.source`]}</p>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={line.quantity}
                      onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                      className="w-20 rounded-md border border-border px-2 py-1.5 focus:border-brand-500 focus:outline-none"
                    />
                    {fieldErrors[`lines.${idx}.quantity`] && (
                      <p className="mt-0.5 text-xs text-status-danger-text">{fieldErrors[`lines.${idx}.quantity`]}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={line.disposition}
                      onChange={(e) => updateLine(idx, { disposition: e.target.value })}
                      className="w-full rounded-md border border-border px-2 py-1.5 focus:border-brand-500 focus:outline-none"
                    >
                      {DISPOSITIONS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={line.returnReason}
                      onChange={(e) => updateLine(idx, { returnReason: e.target.value })}
                      placeholder="必填"
                      className="w-full rounded-md border border-border px-2 py-1.5 focus:border-brand-500 focus:outline-none"
                    />
                    {fieldErrors[`lines.${idx}.returnReason`] && (
                      <p className="mt-0.5 text-xs text-status-danger-text">{fieldErrors[`lines.${idx}.returnReason`]}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={line.batchNo}
                      onChange={(e) => updateLine(idx, { batchNo: e.target.value })}
                      placeholder="批次"
                      className="mb-1 w-full rounded-md border border-border px-2 py-1.5 focus:border-brand-500 focus:outline-none"
                    />
                    <input
                      value={line.serialNos}
                      onChange={(e) => updateLine(idx, { serialNos: e.target.value })}
                      placeholder="序列号（逗号分隔）"
                      className="w-full rounded-md border border-border px-2 py-1.5 focus:border-brand-500 focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={line.remark}
                      onChange={(e) => updateLine(idx, { remark: e.target.value })}
                      placeholder="可选"
                      className="w-full rounded-md border border-border px-2 py-1.5 focus:border-brand-500 focus:outline-none"
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

        <div className="mt-2 rounded-md bg-status-warning-bg p-3 text-xs text-status-warning-text">
          按单拉取退货信息：选择来源类型 → 选择来源单据（收货单按当前采购订单过滤；入库单/质检全量）→ 自动拉取该单据可退行供选择。
          服务端校验来源归属、状态与可退余额（SSOT）。
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "提交中…" : "创建（草稿）"}
          </button>
          {dirty && <span className="text-xs text-status-warning-text">有未保存的更改</span>}
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission="purchase-return:create">
      <PurchaseReturnCreateForm />
    </PermissionGuard>
  );
}