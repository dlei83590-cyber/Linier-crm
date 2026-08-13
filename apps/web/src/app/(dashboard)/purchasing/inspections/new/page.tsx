"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";

interface ReceiptRow {
  id: string;
  code: string | null;
  status: string | null;
  purchaseOrder?: { code: string | null } | null;
}

interface ReceiptLineOption {
  id: string;
  lineNo: number;
  quantity: string;
  rejectedOnReceiptQty: string;
  item?: { code: string | null; name: string | null } | null;
  uom?: { symbol: string | null } | null;
}

interface ReceiptDetail {
  id: string;
  code: string | null;
  status: string | null;
  lines?: ReceiptLineOption[];
}

const MODE_OPTIONS = ["SKIP", "SPOT", "FULL"] as const;

function InspectionCreateForm() {
  const router = useRouter();
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [lines, setLines] = useState<ReceiptLineOption[]>([]);
  const [purchaseReceiptLineId, setPurchaseReceiptLineId] = useState("");
  const [inspectionMode, setInspectionMode] = useState("SKIP");
  const [remark, setRemark] = useState("");
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // 数据源：已收货单列表（GET /api/purchase-receipts FINAL read API）+ 详情行（GET /api/purchase-receipts/{id}）
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<{ total: number; page: number; pageSize: number; items: ReceiptRow[] }>(
      "/api/purchase-receipts?pageSize=100",
      { signal: controller.signal },
    )
      .then((body) => setReceipts(body.data.items ?? []))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载收货单失败", "NETWORK_ERROR"));
      });
    return () => controller.abort();
  }, []);

  const loadReceiptLines = (receiptId: string) => {
    const controller = new AbortController();
    setLines([]);
    setPurchaseReceiptLineId("");
    if (!receiptId) return;
    apiFetch<ReceiptDetail>(`/api/purchase-receipts/${receiptId}`, { signal: controller.signal })
      .then((body) => setLines(body.data.lines ?? []))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载收货行失败", "NETWORK_ERROR"));
      });
    return () => controller.abort();
  };

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

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!purchaseReceiptLineId) errs.purchaseReceiptLineId = "请选择来源收货行";
    if (!inspectionMode) errs.inspectionMode = "请选择质检模式";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        purchaseReceiptLineId,
        inspectionMode,
        ...(remark ? { remark } : {}),
      };
      const body = await apiFetch<{ id: string }>("/api/inspections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setDirty(false);
      // Success convergence：服务端返回 id 导航详情（权威 re-GET）
      router.push(`/purchasing/inspections/${body.data.id}`);
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err : new ApiClientError(0, "创建失败", "NETWORK_ERROR"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 p-4">
        <h1 className="text-lg font-semibold text-slate-800">新建质检记录</h1>
        <Link
          href="/purchasing/inspections"
          onClick={(e) => {
            if (dirty && !window.confirm("有未保存的更改，确定离开？")) e.preventDefault();
          }}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          返回列表
        </Link>
      </div>

      <div className="p-4">
        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            <p>
              {describeStatus(error.status)}：{error.message}
              {error.code ? `（${error.code}）` : ""}
            </p>
          </div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-4 rounded-md bg-slate-50 p-4 text-sm md:grid-cols-2">
          <div>
            <label className="block text-xs text-slate-500">收货单（已 RECEIVED）</label>
            <select
              onChange={(e) => {
                loadReceiptLines(e.target.value);
                markDirty();
              }}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 focus:border-brand-500 focus:outline-none"
            >
              <option value="">选择收货单</option>
              {receipts.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code ?? ""}（{r.status ?? ""}）{r.purchaseOrder ? ` / PO ${r.purchaseOrder.code ?? ""}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500">来源收货行（必填）</label>
            <select
              value={purchaseReceiptLineId}
              onChange={(e) => {
                setPurchaseReceiptLineId(e.target.value);
                markDirty();
              }}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 focus:border-brand-500 focus:outline-none"
            >
              <option value="">选择收货行</option>
              {lines.map((l) => (
                <option key={l.id} value={l.id}>
                  L{l.lineNo} {l.item?.code ?? ""} {l.item?.name ?? ""}（数量 {l.quantity}
                  {l.uom?.symbol ? ` ${l.uom.symbol}` : ""}）
                </option>
              ))}
            </select>
            {fieldErrors.purchaseReceiptLineId && (
              <p className="mt-0.5 text-xs text-red-600">{fieldErrors.purchaseReceiptLineId}</p>
            )}
          </div>
          <div>
            <label className="block text-xs text-slate-500">质检模式（必填）</label>
            <select
              value={inspectionMode}
              onChange={(e) => {
                setInspectionMode(e.target.value);
                markDirty();
              }}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 focus:border-brand-500 focus:outline-none"
            >
              {MODE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            {fieldErrors.inspectionMode && (
              <p className="mt-0.5 text-xs text-red-600">{fieldErrors.inspectionMode}</p>
            )}
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

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "提交中…" : "创建（PENDING）"}
          </button>
          {dirty && <span className="text-xs text-amber-600">有未保存的更改</span>}
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission="inspection:create">
      <InspectionCreateForm />
    </PermissionGuard>
  );
}
