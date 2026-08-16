"use client";

/**
 * Stock Count Create — 新建库存盘点单（F2-6B 批 3）
 *
 * 契约：POST /api/stock-counts（stock-count:create），仅 remark，创建即取号 CNT，初始 DRAFT。
 * 盘点行在详情页经 POST /lines 逐行录入（录入时服务端冻结五维快照）。
 * PermissionGuard 对齐 API requirePermission("stock-count:create")。
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";

function StockCountCreateForm() {
  const router = useRouter();
  const [remark, setRemark] = useState("");
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const body = await apiFetch<{ id: string }>("/api/stock-counts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(remark.trim() ? { remark: remark.trim() } : {}) }),
      });
      setDirty(false);
      router.push(`/inventory/stock-counts/${body.data.id}`);
    } catch (err: unknown) {
      setError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "创建失败", "NETWORK_ERROR"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 p-4">
        <h1 className="text-lg font-semibold text-slate-800">新建库存盘点单</h1>
        <Link
          href="/inventory/stock-counts"
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

        <div className="mb-4 rounded-md bg-slate-50 p-4 text-sm">
          <label className="block text-xs text-slate-500">备注（可选，≤500）</label>
          <textarea
            value={remark}
            onChange={(e) => {
              setRemark(e.target.value);
              setDirty(true);
            }}
            rows={2}
            maxLength={500}
            className="focus:border-brand-500 mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none"
          />
        </div>

        <p className="mb-4 rounded-md bg-amber-50 p-3 text-xs text-amber-700">
          创建后进入 DRAFT；在详情页录入盘点行（录入时服务端冻结账面数量快照并计算差异），随后完成盘点。
        </p>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="bg-brand-600 hover:bg-brand-700 rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "提交中…" : "创建盘点单"}
        </button>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("stock-count", "create")}>
      <StockCountCreateForm />
    </PermissionGuard>
  );
}
