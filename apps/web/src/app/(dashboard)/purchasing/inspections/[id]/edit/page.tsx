"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { CARD_CLASS } from "@/lib/ui-classes";

interface InspectionDetail {
  id: string;
  inspectionMode: string;
  result: string;
  qualifiedQty: string;
  rejectedQty: string;
  remark?: string | null;
  version: number;
  purchaseReceiptLine?: {
    lineNo: number;
    quantity: string;
    rejectedOnReceiptQty: string;
    purchaseReceipt?: { code: string | null; status: string | null } | null;
    item?: { code: string | null; name: string | null } | null;
    uom?: { symbol: string | null } | null;
  } | null;
}

const MODE_OPTIONS = ["SKIP", "SPOT", "FULL"] as const;

function InspectionEditForm() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();

  const [detail, setDetail] = useState<InspectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [notEditable, setNotEditable] = useState(false);

  const [inspectionMode, setInspectionMode] = useState("SKIP");
  const [remark, setRemark] = useState("");
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // 加载详情（Edit 回填 + version CAS 源）
  const loadDetail = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<InspectionDetail>(`/api/inspections/${id}`, { signal: controller.signal })
      .then((body) => {
        const d = body.data;
        setDetail(d);
        if (d.result !== "PENDING") {
          setNotEditable(true);
          return;
        }
        setNotEditable(false);
        setVersion(d.version);
        setInspectionMode(d.inspectionMode);
        setRemark(d.remark ?? "");
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

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
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
        version,
        inspectionMode,
        ...(remark ? { remark } : {}),
      };
      await apiFetch<InspectionDetail>(`/api/inspections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setDirty(false);
      // Success convergence：导航详情（权威 re-GET）
      router.push(`/purchasing/inspections/${id}`);
    } catch (err: unknown) {
      // 409 VERSION_CONFLICT：不自动 retry、不覆盖本地事实；提示 + 用户确认后重新载入 authoritative detail
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
      <div className={CARD_CLASS}>
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h1 className="text-lg font-semibold text-slate-800">编辑质检记录</h1>
          <Link
            href={`/purchasing/inspections/${id}`}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            返回详情
          </Link>
        </div>
        <div className="p-6">
          <p className="text-sm text-amber-600">
            仅 PENDING 状态可编辑（当前 {detail.result}）——质检结果已定稿，不可修改。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center justify-between border-b border-slate-200 p-4">
        <h1 className="text-lg font-semibold text-slate-800">编辑质检记录</h1>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-amber-600">有未保存的更改</span>}
          <Link
            href={`/purchasing/inspections/${id}`}
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

        <div className="mb-4 rounded-md bg-slate-50 p-4 text-sm">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500">来源收货行</p>
              <p className="mt-1 font-medium text-slate-800">
                {detail?.purchaseReceiptLine?.purchaseReceipt?.code ?? "—"} / L
                {detail?.purchaseReceiptLine?.lineNo ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">物料</p>
              <p className="mt-1 text-slate-700">
                {detail?.purchaseReceiptLine?.item
                  ? `${detail.purchaseReceiptLine.item.code ?? ""} ${detail.purchaseReceiptLine.item.name ?? ""}`.trim()
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">到货数量</p>
              <p className="mt-1 text-slate-700">
                {detail?.purchaseReceiptLine?.quantity ?? "—"}
                {detail?.purchaseReceiptLine?.uom?.symbol ? ` ${detail.purchaseReceiptLine.uom.symbol}` : ""}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">现场拒收</p>
              <p className="mt-1 text-slate-700">{detail?.purchaseReceiptLine?.rejectedOnReceiptQty ?? "0"}</p>
            </div>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-4 rounded-md bg-slate-50 p-4 text-sm md:grid-cols-2">
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
            {submitting ? "保存中…" : "保存（PENDING）"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission="inspection:edit">
      <InspectionEditForm />
    </PermissionGuard>
  );
}