"use client";

/**
 * Sales Order Edit — 编辑销售订单（F2-6B 批 3）
 *
 * 契约：PATCH /api/sales-orders/:id，仅 DRAFT 可编辑，乐观锁 version CAS。
 * 可编辑头字段：requestedDeliveryDate / paymentTerm / incoterm / remark（nullable 支持清空）。
 * 只发送真正 changed 的字段（避免无条件生成无意义 Revision）。
 * customer / currency / status / 来源报价 / 金额均不可从 Edit 表单修改。
 * VERSION_CONFLICT → 提示重新载入（不 silent retry）。
 * PermissionGuard 对齐 API requirePermission("sales-order:edit")。
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { CARD_CLASS } from "@/lib/ui-classes";
import { formatMoney } from "@/lib/format";

interface SalesOrderDetail {
  id: string;
  code: string;
  status: string;
  version: number;
  requestedDeliveryDate?: string | null;
  paymentTerm?: string | null;
  incoterm?: string | null;
  remark?: string | null;
  currency: string;
  totalAmount: string;
  customer?: { id: string; code: string | null; name: string | null } | null;
  quotation?: { id: string; code: string | null; status: string | null } | null;
}

function toLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function SalesOrderEditForm() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";

  const [detail, setDetail] = useState<SalesOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [notEditable, setNotEditable] = useState(false);

  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState("");
  const [paymentTerm, setPaymentTerm] = useState("");
  const [incoterm, setIncoterm] = useState("");
  const [remark, setRemark] = useState("");
  const [init, setInit] = useState({ requestedDeliveryDate: "", paymentTerm: "", incoterm: "", remark: "" });
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const dirty =
    requestedDeliveryDate !== init.requestedDeliveryDate ||
    paymentTerm !== init.paymentTerm ||
    incoterm !== init.incoterm ||
    remark !== init.remark;

  const loadDetail = useCallback(async () => {
    try {
      const body = await apiFetch<SalesOrderDetail>(`/api/sales-orders/${id}`);
      setDetail(body.data);
      setRequestedDeliveryDate(toLocalInput(body.data.requestedDeliveryDate));
      setPaymentTerm(body.data.paymentTerm ?? "");
      setIncoterm(body.data.incoterm ?? "");
      setRemark(body.data.remark ?? "");
      setInit({
        requestedDeliveryDate: toLocalInput(body.data.requestedDeliveryDate),
        paymentTerm: body.data.paymentTerm ?? "",
        incoterm: body.data.incoterm ?? "",
        remark: body.data.remark ?? "",
      });
      if (body.data.status !== "DRAFT") setNotEditable(true);
    } catch (err: unknown) {
      setError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "加载失败", "NETWORK_ERROR"),
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const saveHeader = async () => {
    if (!detail || submitting) return;
    const changes: Record<string, unknown> = {};
    if (requestedDeliveryDate !== init.requestedDeliveryDate)
      changes.requestedDeliveryDate = toIso(requestedDeliveryDate);
    if (paymentTerm !== init.paymentTerm)
      changes.paymentTerm = paymentTerm.trim() === "" ? null : paymentTerm;
    if (incoterm !== init.incoterm) changes.incoterm = incoterm.trim() === "" ? null : incoterm;
    if (remark !== init.remark) changes.remark = remark.trim() === "" ? null : remark;
    if (Object.keys(changes).length === 0) {
      setFieldErrors({ scope: "头字段没有修改" });
      return;
    }

    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      await apiFetch(`/api/sales-orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: detail.version, ...changes, changeReason: "编辑销售订单头" }),
      });
      await loadDetail();
    } catch (err: unknown) {
      setError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "保存失败", "NETWORK_ERROR"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="rounded-lg border border-border bg-surface p-6 text-sm text-ink-muted">加载中…</div>;
  }

  if (error && !detail) {
    return (
      <div className="rounded-lg border border-status-danger-border bg-status-danger-bg p-6 text-sm text-status-danger-text">
        {describeStatus(error.status)}：{error.message}
        {error.code ? `（${error.code}）` : ""}
        <div className="mt-3">
          <Link href={`/sales/orders/${id}`} className="text-brand-600 hover:underline">
            返回详情
          </Link>
        </div>
      </div>
    );
  }

  if (notEditable && detail) {
    return (
      <div className={CARD_CLASS}>
        <div className="flex items-center justify-between border-b border-border p-4">
          <h1 className="text-lg font-semibold text-ink-primary">编辑销售订单 — {detail.code}</h1>
          <Link
            href={`/sales/orders/${id}`}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-canvas"
          >
            返回详情
          </Link>
        </div>
        <div className="p-6">
          <p className="text-sm text-status-warning-text">
            仅 DRAFT 状态可编辑（当前 {detail.status}）——已确认订单需走后续 amendment 流程。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center justify-between border-b border-border p-4">
        <h1 className="text-lg font-semibold text-ink-primary">
          编辑销售订单 — {detail?.code}
          <span className="ml-2 text-xs font-normal text-ink-muted">
            {detail?.status}（v{detail?.version}）
          </span>
        </h1>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-status-warning-text">有未保存的更改</span>}
          <Link
            href={`/sales/orders/${id}`}
            onClick={(e) => {
              if (dirty && !window.confirm("有未保存的更改，确定离开？")) e.preventDefault();
            }}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-canvas"
          >
            返回详情
          </Link>
        </div>
      </div>

      <div className="p-4">
        {error && (
          <div className="mb-4 rounded-md bg-status-danger-bg p-3 text-sm text-status-danger-text">
            <p>
              {describeStatus(error.status)}：{error.message}
              {error.code ? `（${error.code}）` : ""}
            </p>
            {error.code === "VERSION_CONFLICT" && (
              <div className="mt-2">
                <p className="text-xs">数据已被他人修改，未保存的更改可能丢失。重新载入最新数据后请重新确认修改。</p>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("未保存的更改将丢失，确定重新载入最新数据？")) {
                      setError(null);
                      setNotEditable(false);
                      loadDetail();
                    }
                  }}
                  className="bg-brand-600 hover:bg-brand-700 mt-2 rounded-md px-3 py-1 text-xs font-medium text-white"
                >
                  重新载入最新数据
                </button>
              </div>
            )}
          </div>
        )}

        {fieldErrors.scope && (
          <div className="mb-4 rounded-md border border-status-warning-border bg-status-warning-bg p-3 text-sm text-status-warning-text">
            {fieldErrors.scope}
          </div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-4 rounded-md bg-canvas p-4 text-sm md:grid-cols-3">
          <div>
            <label className="block text-xs text-ink-secondary">客户（只读）</label>
            <p className="mt-1 text-ink-secondary">
              {detail?.customer ? `${detail.customer.code ?? ""} ${detail.customer.name ?? ""}`.trim() : "—"}
            </p>
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">币种（只读）</label>
            <p className="mt-1 text-ink-secondary">{detail?.currency ?? "—"}</p>
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">含税合计（只读）</label>
            <p className="mt-1 text-ink-secondary">{formatMoney(detail?.totalAmount ?? "0", detail?.currency ?? "CNY")}</p>
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">要求交货日期（可选，清空即置空）</label>
            <input
              type="datetime-local"
              value={requestedDeliveryDate}
              onChange={(e) => setRequestedDeliveryDate(e.target.value)}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">付款条件（可选，≤50）</label>
            <input
              value={paymentTerm}
              onChange={(e) => setPaymentTerm(e.target.value)}
              maxLength={50}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">贸易术语（可选，≤50）</label>
            <input
              value={incoterm}
              onChange={(e) => setIncoterm(e.target.value)}
              maxLength={50}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
            />
          </div>
          <div className="col-span-2 md:col-span-3">
            <label className="block text-xs text-ink-secondary">备注（可选，≤1000，清空即置空）</label>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={2}
              maxLength={1000}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={saveHeader}
            disabled={submitting}
            className="bg-brand-600 hover:bg-brand-700 rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "保存中…" : "保存头字段"}
          </button>
          {dirty && <span className="text-xs text-status-warning-text">有未保存的更改</span>}
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("sales-order", "edit")}>
      <SalesOrderEditForm />
    </PermissionGuard>
  );
}