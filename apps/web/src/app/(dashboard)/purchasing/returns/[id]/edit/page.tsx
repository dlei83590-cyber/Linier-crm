"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS } from "@/lib/ui-classes";

const RETURN_TYPES = ["REJECTED_ON_RECEIPT", "RETURN_AFTER_STOCK_IN", "QUALITY_ISSUE"] as const;
const SOURCE_REF_TYPES = ["RECEIPT_LINE", "WAREHOUSE_RECEIPT_LINE", "INSPECTION"] as const;
const DISPOSITIONS = ["REPLACE_REQUIRED", "CREDIT_ONLY"] as const;

interface ReturnDetailLine {
  id: string;
  quantity: string;
  sourceRefType?: string | null;
  disposition?: string | null;
  returnReason?: string | null;
  batchNo?: string | null;
  serialNos?: string[] | null;
  remark?: string | null;
  sourcePurchaseReceiptLine?: { id: string | null } | null;
  sourceWarehouseReceiptLine?: { id: string | null } | null;
  sourceInspection?: { id: string | null } | null;
}

interface ReturnDetail {
  id: string;
  code: string;
  status: string;
  version: number;
  returnType?: string | null;
  remark?: string | null;
  purchaseOrder?: { id: string | null; code: string | null } | null;
  lines?: ReturnDetailLine[];
}

interface LineForm {
  sourceRefType: string;
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

const EMPTY_LINE: LineForm = {
  sourceRefType: "RECEIPT_LINE",
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

function PurchaseReturnEditForm() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();

  const [detail, setDetail] = useState<ReturnDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [notEditable, setNotEditable] = useState(false);

  const [returnType, setReturnType] = useState("REJECTED_ON_RECEIPT");
  const [remark, setRemark] = useState("");
  const [lines, setLines] = useState<LineForm[]>([]);
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // 加载详情（Edit 回填 + version CAS 源）
  const loadDetail = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<ReturnDetail>(`/api/purchase-returns/${id}`, { signal: controller.signal })
      .then((body) => {
        const d = body.data;
        setDetail(d);
        if (d.status !== "DRAFT") {
          setNotEditable(true);
          return;
        }
        setNotEditable(false);
        setVersion(d.version);
        setReturnType(d.returnType ?? "REJECTED_ON_RECEIPT");
        setRemark(d.remark ?? "");
        setLines(
          (d.lines ?? []).map((l) => ({
            sourceRefType: l.sourceRefType ?? "RECEIPT_LINE",
            sourcePurchaseReceiptLineId: l.sourcePurchaseReceiptLine?.id ?? "",
            sourceWarehouseReceiptLineId: l.sourceWarehouseReceiptLine?.id ?? "",
            sourceInspectionId: l.sourceInspection?.id ?? "",
            quantity: l.quantity,
            disposition: l.disposition ?? "REPLACE_REQUIRED",
            returnReason: l.returnReason ?? "",
            batchNo: l.batchNo ?? "",
            serialNos: (l.serialNos ?? []).join(", "),
            remark: l.remark ?? "",
          })),
        );
        setDirty(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载失败", "NETWORK_ERROR"));
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
      const payload: Record<string, unknown> = {
        version,
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
      await apiFetch<ReturnDetail>(`/api/purchase-returns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setDirty(false);
      // Success convergence：导航详情（权威 re-GET）
      router.push(`/purchasing/returns/${id}`);
    } catch (err: unknown) {
      // 409 VERSION_CONFLICT：不自动 retry、不覆盖本地事实；提示 + 用户确认后重新载入
      setError(err instanceof ApiClientError ? err : new ApiClientError(0, "保存失败", "NETWORK_ERROR"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-400">加载中…</div>
    );
  }

  if (notEditable && detail) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h1 className="text-lg font-semibold text-slate-800">编辑采购退货</h1>
          <Link
            href={`/purchasing/returns/${id}`}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            返回详情
          </Link>
        </div>
        <div className="p-6">
          <p className="text-sm text-amber-600">
            仅 DRAFT 状态可编辑（当前 {detail.status}）——已退货事实不可修改。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 p-4">
        <h1 className="text-lg font-semibold text-slate-800">编辑采购退货</h1>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-amber-600">有未保存的更改</span>}
          <Link
            href={`/purchasing/returns/${id}`}
            onClick={(e) => {
              if (dirty && !window.confirm("有未保存的更改，确定离开？")) e.preventDefault();
            }}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            返回详情
          </Link>
        </div>
      </div>

      <div className="p-4">
        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            <p>
              {describeStatus(error.status)}：{error.message}
              {error.code ? `（${error.code}）` : ""}
            </p>
            {error.code === "VERSION_CONFLICT" && (
              <div className="mt-2">
                <p className="text-xs">
                  数据已被他人修改（VERSION_CONFLICT），未保存的更改可能丢失。重新载入最新数据后请重新确认修改。
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("未保存的更改将丢失，确定重新载入最新数据？")) {
                      setError(null);
                      loadDetail();
                    }
                  }}
                  className="mt-2 rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700"
                >
                  重新载入最新数据
                </button>
              </div>
            )}
          </div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-4 rounded-md bg-slate-50 p-4 text-sm md:grid-cols-3">
          <div>
            <p className="text-xs text-slate-500">退货单号</p>
            <p className="mt-1 font-medium text-slate-800">{detail?.code}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">采购订单</p>
            <p className="mt-1 text-slate-700">{detail?.purchaseOrder?.code ?? "—"}</p>
          </div>
          <div>
            <label className="block text-xs text-slate-500">退货类型（必填）</label>
            <select
              value={returnType}
              onChange={(e) => {
                setReturnType(e.target.value);
                markDirty();
              }}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 focus:border-brand-500 focus:outline-none"
            >
              {RETURN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-slate-500">备注（可选，≤500）</label>
            <textarea
              value={remark}
              onChange={(e) => {
                setRemark(e.target.value);
                markDirty();
              }}
              rows={2}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 focus:border-brand-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-700">退货明细（至少一行）</h2>
          <button
            type="button"
            onClick={addLine}
            className={BUTTON_PRIMARY_CLASS}
          >
            + 添加行
          </button>
        </div>
        {fieldErrors.lines && <p className="mb-2 text-xs text-red-600">{fieldErrors.lines}</p>}

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
              <tr>
                <th className="px-3 py-2">来源类型</th>
                <th className="px-3 py-2">来源 ID（exactly-one）</th>
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
                      onChange={(e) => updateLine(idx, { sourceRefType: e.target.value })}
                      className="w-full rounded-md border border-slate-200 px-2 py-1.5 focus:border-brand-500 focus:outline-none"
                    >
                      {SOURCE_REF_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    {line.sourceRefType === "RECEIPT_LINE" && (
                      <input
                        value={line.sourcePurchaseReceiptLineId}
                        onChange={(e) => updateLine(idx, { sourcePurchaseReceiptLineId: e.target.value })}
                        placeholder="收货行 ID"
                        className="w-full rounded-md border border-slate-200 px-2 py-1.5 focus:border-brand-500 focus:outline-none"
                      />
                    )}
                    {line.sourceRefType === "WAREHOUSE_RECEIPT_LINE" && (
                      <input
                        value={line.sourceWarehouseReceiptLineId}
                        onChange={(e) => updateLine(idx, { sourceWarehouseReceiptLineId: e.target.value })}
                        placeholder="入库行 ID"
                        className="w-full rounded-md border border-slate-200 px-2 py-1.5 focus:border-brand-500 focus:outline-none"
                      />
                    )}
                    {line.sourceRefType === "INSPECTION" && (
                      <input
                        value={line.sourceInspectionId}
                        onChange={(e) => updateLine(idx, { sourceInspectionId: e.target.value })}
                        placeholder="质检 ID"
                        className="w-full rounded-md border border-slate-200 px-2 py-1.5 focus:border-brand-500 focus:outline-none"
                      />
                    )}
                    {fieldErrors[`lines.${idx}.source`] && (
                      <p className="mt-0.5 text-xs text-red-600">{fieldErrors[`lines.${idx}.source`]}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={line.quantity}
                      onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                      className="w-20 rounded-md border border-slate-200 px-2 py-1.5 focus:border-brand-500 focus:outline-none"
                    />
                    {fieldErrors[`lines.${idx}.quantity`] && (
                      <p className="mt-0.5 text-xs text-red-600">{fieldErrors[`lines.${idx}.quantity`]}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={line.disposition}
                      onChange={(e) => updateLine(idx, { disposition: e.target.value })}
                      className="w-full rounded-md border border-slate-200 px-2 py-1.5 focus:border-brand-500 focus:outline-none"
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
                      className="w-full rounded-md border border-slate-200 px-2 py-1.5 focus:border-brand-500 focus:outline-none"
                    />
                    {fieldErrors[`lines.${idx}.returnReason`] && (
                      <p className="mt-0.5 text-xs text-red-600">{fieldErrors[`lines.${idx}.returnReason`]}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={line.batchNo}
                      onChange={(e) => updateLine(idx, { batchNo: e.target.value })}
                      placeholder="批次"
                      className="mb-1 w-full rounded-md border border-slate-200 px-2 py-1.5 focus:border-brand-500 focus:outline-none"
                    />
                    <input
                      value={line.serialNos}
                      onChange={(e) => updateLine(idx, { serialNos: e.target.value })}
                      placeholder="序列号（逗号分隔）"
                      className="w-full rounded-md border border-slate-200 px-2 py-1.5 focus:border-brand-500 focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={line.remark}
                      onChange={(e) => updateLine(idx, { remark: e.target.value })}
                      placeholder="可选"
                      className="w-full rounded-md border border-slate-200 px-2 py-1.5 focus:border-brand-500 focus:outline-none"
                    />
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

        <div className="mt-2 rounded-md bg-amber-50 p-3 text-xs text-amber-700">
          CONTRACT GAP：来源行（收货行 / 入库行 / 质检）为父单据详情行 ID，当前无行级独立列表 API；来源 ID 可从对应父单据详情
          GET（/api/purchase-receipts/{'{id}'}、/api/warehouse-receipts/{'{id}'}、/api/inspections/{'{id}'}）获取。服务端校验来源归属、POSTED
          状态与可退余额（SSOT）。
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "保存中…" : "保存（DRAFT）"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission="purchase-return:edit">
      <PurchaseReturnEditForm />
    </PermissionGuard>
  );
}