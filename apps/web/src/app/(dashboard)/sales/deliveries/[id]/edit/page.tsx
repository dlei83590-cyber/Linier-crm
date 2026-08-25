"use client";

/**
 * Delivery Edit — 编辑送货单（F2-6B 批 3）
 *
 * 契约：PATCH /api/deliveries/:id，仅 DRAFT 可编辑（READY 后行彻底冻结），乐观锁 version CAS。
 * 可编辑头字段：deliveryDate / expectedArrivalDate / carrier / trackingNo / remark（nullable 支持清空）。
 * 只发送真正 changed 的字段；salesOrderId/customerId/status/行 均不可从 Edit 表单修改。
 * VERSION_CONFLICT → 提示重新载入（不 silent retry）。
 * PermissionGuard 对齐 API requirePermission("delivery:edit")。
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, CARD_CLASS, INPUT_CLASS } from "@/lib/ui-classes";
import { PageLoading } from "@/components/ui/skeleton";
import { salesStatusLabel } from "@/lib/sales-status";

interface DeliveryDetail {
  id: string;
  code: string;
  status: string;
  version: number;
  deliveryDate?: string | null;
  expectedArrivalDate?: string | null;
  carrier?: string | null;
  trackingNo?: string | null;
  remark?: string | null;
  customer?: { id: string; code: string | null; name: string | null } | null;
  salesOrder?: { id: string; code: string | null; status: string | null } | null;
}

function toLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  // 用户指令 2026-08-21：全站取消分钟格式 → date（YYYY-MM-DD）
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function DeliveryEditForm() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";

  const [detail, setDetail] = useState<DeliveryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [notEditable, setNotEditable] = useState(false);

  const [deliveryDate, setDeliveryDate] = useState("");
  const [expectedArrivalDate, setExpectedArrivalDate] = useState("");
  const [carrier, setCarrier] = useState("");
  const [trackingNo, setTrackingNo] = useState("");
  const [remark, setRemark] = useState("");
  const [init, setInit] = useState({
    deliveryDate: "",
    expectedArrivalDate: "",
    carrier: "",
    trackingNo: "",
    remark: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const dirty =
    deliveryDate !== init.deliveryDate ||
    expectedArrivalDate !== init.expectedArrivalDate ||
    carrier !== init.carrier ||
    trackingNo !== init.trackingNo ||
    remark !== init.remark;

  const loadDetail = useCallback(async () => {
    try {
      const body = await apiFetch<DeliveryDetail>(`/api/deliveries/${id}`);
      setDetail(body.data);
      setDeliveryDate(toLocalInput(body.data.deliveryDate));
      setExpectedArrivalDate(toLocalInput(body.data.expectedArrivalDate));
      setCarrier(body.data.carrier ?? "");
      setTrackingNo(body.data.trackingNo ?? "");
      setRemark(body.data.remark ?? "");
      setInit({
        deliveryDate: toLocalInput(body.data.deliveryDate),
        expectedArrivalDate: toLocalInput(body.data.expectedArrivalDate),
        carrier: body.data.carrier ?? "",
        trackingNo: body.data.trackingNo ?? "",
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
    if (deliveryDate !== init.deliveryDate) changes.deliveryDate = toIso(deliveryDate);
    if (expectedArrivalDate !== init.expectedArrivalDate)
      changes.expectedArrivalDate = toIso(expectedArrivalDate);
    if (carrier !== init.carrier) changes.carrier = carrier.trim() === "" ? null : carrier;
    if (trackingNo !== init.trackingNo)
      changes.trackingNo = trackingNo.trim() === "" ? null : trackingNo;
    if (remark !== init.remark) changes.remark = remark.trim() === "" ? null : remark;
    if (Object.keys(changes).length === 0) {
      setFieldErrors({ scope: "头字段没有修改" });
      return;
    }

    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      await apiFetch(`/api/deliveries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: detail.version, ...changes, changeReason: "编辑送货单头" }),
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
    return (
      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <PageLoading rows={4} />
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="rounded-lg border border-status-danger-border bg-status-danger-bg p-6 text-sm text-status-danger-text">
        {describeStatus(error.status)}：{error.message}
        {error.code ? `（${error.code}）` : ""}
        <div className="mt-3">
          <Link href={`/sales/deliveries/${id}`} className="text-brand-600 hover:underline">
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
          <h1 className="text-lg font-semibold text-ink-primary">编辑送货单 — {detail.code}</h1>
          <Link
            href={`/sales/deliveries/${id}`}
            className={BUTTON_SECONDARY_CLASS}
          >
            返回详情
          </Link>
        </div>
        <div className="p-6">
          <p className="text-sm text-status-warning-text">
            仅 草稿 状态可编辑（当前 {detail.status}）——READY 后行已冻结，错误需取消后新建。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center justify-between border-b border-border p-4">
        <h1 className="text-lg font-semibold text-ink-primary">
          编辑送货单 — {detail?.code}
          <span className="ml-2 text-xs font-normal text-ink-muted">
            {salesStatusLabel("delivery", detail?.status ?? "")}
          </span>
        </h1>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-status-warning-text">有未保存的更改</span>}
          <Link
            href={`/sales/deliveries/${id}`}
            onClick={(e) => {
              if (dirty && !window.confirm("有未保存的更改，确定离开？")) e.preventDefault();
            }}
            className={BUTTON_SECONDARY_CLASS}
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

        <div className="mb-4 grid grid-cols-1 gap-4 rounded-md bg-canvas p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="block text-xs text-ink-secondary">客户（只读）</label>
            <p className="mt-1 text-ink-secondary">
              {detail?.customer ? `${detail.customer.code ?? ""} ${detail.customer.name ?? ""}`.trim() : "—"}
            </p>
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">来源销售订单（只读）</label>
            <p className="mt-1 text-ink-secondary">{detail?.salesOrder?.code ?? "—"}</p>
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">交付日期（可选）</label>
            <input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              className={"mt-1 " + INPUT_CLASS}
            />
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">预计到达日期（可选，清空即置空）</label>
            <input
              type="date"
              value={expectedArrivalDate}
              onChange={(e) => setExpectedArrivalDate(e.target.value)}
              className={"mt-1 " + INPUT_CLASS}
            />
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">承运方（可选，≤100）</label>
            <input
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              maxLength={100}
              className={"mt-1 " + INPUT_CLASS}
            />
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">运单号（可选，≤100）</label>
            <input
              value={trackingNo}
              onChange={(e) => setTrackingNo(e.target.value)}
              maxLength={100}
              className={"mt-1 " + INPUT_CLASS}
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className="block text-xs text-ink-secondary">备注（可选，≤1000，清空即置空）</label>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={2}
              maxLength={1000}
              className={"mt-1 " + INPUT_CLASS}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={saveHeader}
            disabled={submitting}
            className={BUTTON_PRIMARY_CLASS}
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
    <PermissionGuard permission={actionPermission("delivery", "edit")}>
      <DeliveryEditForm />
    </PermissionGuard>
  );
}