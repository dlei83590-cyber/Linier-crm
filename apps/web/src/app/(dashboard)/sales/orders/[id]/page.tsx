"use client";

/**
 * Sales Order Detail — 销售订单详情页（F2-6A Sales Read Foundation + F2-6B 批 1 动作）
 *
 * 只读 Detail：AppPage → EntityDetailWorkspace（Header → Summary → Lines）。
 * F2-6B 批 1：状态 Gate + 权限 Gate 后提供 Create Delivery（delivery:create）动作。
 * 按 CTO REQUEST CHANGES（93/100 Blocking ①）修复：
 * 不再“一键全量”POST——点击按钮打开 source-selection dialog：
 * 仅列出 remainingQty > 0 的行；每行 checkbox + quantity（默认剩余量，可改小）；
 * 至少选择一行；submit 后才 POST（后端逐行锁内校验 quantity <= availableQty）。
 * 正确暴露 backend 的 partial delivery contract。
 * confirm/cancel 等其它 factActions 仍不开放；不提供 Edit 入口。
 * PermissionGuard 对齐 API requirePermission("sales-order:view")。
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, ConfirmActionDialog, EntityDetailWorkspace, ErrorPanel, StatusBadge } from "@/components/workspace";
import { CopyButton } from "@/components/ui/copy-button";
import { PageLoading } from "@/components/ui/skeleton";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { salesStatusLabel, salesStatusTone } from "@/lib/sales-status";
import { useSession } from "@/lib/session-context";
import { formatDate, formatMoney } from "@/lib/format";

interface SalesOrderLine {
  id: string;
  lineNo: number;
  description?: string | null;
  quantity: string;
  deliveredQty?: string;
  remainingQty?: string;
  unitPrice: string;
  totalAmount?: string;
  item?: { id: string; code: string | null; name: string | null; model?: string | null } | null;
}

/** 履约回显：本订单已创建的送货单（GET /api/sales-orders/:id 的 deliveries 投影） */
interface SalesOrderDelivery {
  id: string;
  code: string;
  status: string;
  deliveryDate: string;
  createdAt: string;
  _count?: { lines: number };
}

interface DeliveryCreatedResponse {
  id: string;
  code: string;
  status: string;
}

interface SalesOrderDetail {
  id: string;
  code: string;
  status: string;
  orderDate: string;
  requestedDeliveryDate?: string | null;
  paymentTerm?: string | null;
  incoterm?: string | null;
  currency: string;
  totalAmount: string;
  remark?: string | null;
  customer?: { id: string; code: string | null; name: string | null } | null;
  quotation?: { id: string; code: string | null; status: string | null } | null;
  lines?: SalesOrderLine[];
  deliveries?: SalesOrderDelivery[];
  createdAt: string;
}

/** Q 线投影：BOM 预计用料行（GET /api/sales-orders/:id/material-requirements）
 * 吨数折算：只消费后端 UomConversion 事实；无换算 → tonnage=null/tonnageConvertible=false/reason。
 * 红线：前端禁止自写换算系数，禁止把未换算项显示为 0。 */
interface MaterialRequirement {
  itemId: string;
  itemCode: string | null;
  itemName: string | null;
  uom: string | null;
  requiredUom: string | null;
  requiredQty: number;
  tonnage: number | null;
  tonnageConvertible: boolean;
  reason: string | null;
  onHandQty: number;
}

/** Q 线投影：推荐供应商行（GET /api/sales-orders/:id/supplier-recommendations） */
interface SupplierRecommendationRow {
  supplierId: string;
  supplierCode: string | null;
  supplierName: string | null;
  creditRating: string | null;
  supplierRating: string | null; // PartnerCredit.rating（canonical 供应商评级；规则门槛比较依据）
  settlementTerms: string | null;
  itemCount: number;
  preferredCount: number;
  totalPrice?: number;
}

/** 推荐供应商响应（cc-06：含客户等级/门槛/依据文案；页面必须展示 basis） */
interface SupplierRecommendationResponse {
  rows: SupplierRecommendationRow[];
  customerLevel: string | null;
  minimumSupplierRating: string | null;
  ruleApplied: boolean;
  basis: string;
}

/** dialog 选择状态：行 id → 是否勾选 + 交付数量 */
interface DeliverySelection {
  checked: boolean;
  quantity: string;
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
}

function SalesOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { state } = useSession();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<SalesOrderDetail | null>(null);
  // Q 线投影状态（FRT-06：独立 loading/error/retry；API 失败 ≠ 无 BOM/无供应商）
  const [materials, setMaterials] = useState<MaterialRequirement[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(true);
  const [materialsError, setMaterialsError] = useState<ApiClientError | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierRecommendationResponse | null>(null);
  const [suppliersLoading, setSuppliersLoading] = useState(true);
  const [suppliersError, setSuppliersError] = useState<ApiClientError | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiClientError | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selections, setSelections] = useState<Record<string, DeliverySelection>>({});
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"confirm" | "cancel" | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canCreateDelivery = hasPermission(roles, actionPermission("delivery", "create"));
  const canEdit = hasPermission(roles, actionPermission("sales-order", "edit"));
  const canApprove = hasPermission(roles, actionPermission("sales-order", "approve"));
  const canClose = hasPermission(roles, actionPermission("sales-order", "close"));
  const canDeliver =
    detail !== null &&
    (detail.status === "CONFIRMED" || detail.status === "PARTIALLY_DELIVERED");
  const remainingLines = (detail?.lines ?? []).filter(
    (l) => Number(l.remainingQty ?? l.quantity) > 0,
  );

  // ── 打开 dialog：默认全部剩余行勾选、数量 = remainingQty（用户可改小） ──
  const openDeliveryDialog = () => {
    if (remainingLines.length === 0) return;
    const next: Record<string, DeliverySelection> = {};
    for (const l of remainingLines) {
      next[l.id] = { checked: true, quantity: String(l.remainingQty ?? l.quantity) };
    }
    setSelections(next);
    setDialogError(null);
    setDialogOpen(true);
  };

  const closeDeliveryDialog = () => {
    setDialogOpen(false);
    setDialogError(null);
  };

  const updateSelection = (lineId: string, patch: Partial<DeliverySelection>) => {
    setSelections((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));
  };

  // ── submit：校验（至少一行；每行 quantity > 0 且 <= 剩余量）后才 POST ──
  const handleCreateDelivery = async () => {
    if (!detail || actionBusy) return;
    const selected = remainingLines.filter((l) => selections[l.id]?.checked);
    if (selected.length === 0) {
      setDialogError("请至少选择一行");
      return;
    }
    for (const l of selected) {
      const qty = Number(selections[l.id].quantity);
      const max = Number(l.remainingQty ?? l.quantity);
      if (!selections[l.id].quantity || !(qty > 0)) {
        setDialogError(`第 ${l.lineNo} 行：数量必须大于 0`);
        return;
      }
      if (qty > max) {
        setDialogError(`第 ${l.lineNo} 行：数量不能超过剩余可交付量 ${max}`);
        return;
      }
    }
    setActionBusy(true);
    setActionError(null);
    setDialogError(null);
    try {
      const body = await apiFetch<DeliveryCreatedResponse>(`/api/sales-orders/${id}/deliveries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: selected.map((l) => ({
            sourceSalesOrderLineId: l.id,
            quantity: Number(selections[l.id].quantity),
          })),
          changeReason: "从销售订单创建送货单",
        }),
      });
      closeDeliveryDialog();
      router.push(`/sales/deliveries/${body.data.id}`);
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "创建送货单失败", "NETWORK_ERROR"),
      );
      setActionBusy(false);
    }
  };

  const refreshDetail = async () => {
    try {
      const body = await apiFetch<SalesOrderDetail>(`/api/sales-orders/${id}`);
      setDetail(body.data);
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "刷新失败", "NETWORK_ERROR"),
      );
    }
  };

  // ── 确认订单 / 取消订单（无 body；后端状态机 + 审批门禁兜底） ──
  const runAction = async (action: "confirm" | "cancel") => {
    if (!detail || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await apiFetch(`/api/sales-orders/${id}/${action}`, { method: "POST" });
      await refreshDetail();
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "操作失败", "NETWORK_ERROR"),
      );
    } finally {
      setActionBusy(false);
    }
  };

  // ── Q 线投影：BOM 预计用料 + 推荐供应商（只读；独立 loading/error/retry） ──
  // 禁止 .catch(() => undefined) 吞错：API 失败必须显示真实错误并提供重试，
  // 不得把「接口失败」伪装成「无配方/无供应商」的空态。
  const loadProjections = useCallback(
    (signal?: AbortSignal) => {
      setMaterialsLoading(true);
      setSuppliersLoading(true);
      setMaterialsError(null);
      setSuppliersError(null);
      apiFetch<MaterialRequirement[]>(`/api/sales-orders/${id}/material-requirements`, { signal })
        .then((body) => setMaterials(body.data))
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setMaterialsError(
            err instanceof ApiClientError
              ? err
              : new ApiClientError(0, "加载 BOM 用料失败", "NETWORK_ERROR"),
          );
        })
        .finally(() => {
          if (!signal?.aborted) setMaterialsLoading(false);
        });
      apiFetch<SupplierRecommendationResponse>(`/api/sales-orders/${id}/supplier-recommendations`, { signal })
        .then((body) => setSuppliers(body.data))
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setSuppliersError(
            err instanceof ApiClientError
              ? err
              : new ApiClientError(0, "加载推荐供应商失败", "NETWORK_ERROR"),
          );
        })
        .finally(() => {
          if (!signal?.aborted) setSuppliersLoading(false);
        });
    },
    [id],
  );

  const retryProjections = () => loadProjections();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<SalesOrderDetail>(`/api/sales-orders/${id}`, { signal: controller.signal })
      .then((body) => setDetail(body.data))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    loadProjections(controller.signal);
    return () => controller.abort();
  }, [id, loadProjections, reloadKey]);

  if (loading) {
    return (
      <AppPage>
        <div className="border-border bg-surface overflow-hidden rounded-lg border">
          <PageLoading rows={5} />
        </div>
      </AppPage>
    );
  }

  if (error || !detail) {
    return (
      <AppPage>
        <ErrorPanel error={error} onRetry={() => setReloadKey((k) => k + 1)} />
        <Link href="/sales/orders" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          返回列表
        </Link>
      </AppPage>
    );
  }

  return (
    <AppPage>
      {actionError && (
        <div className="border-status-danger-border mb-3 rounded-md border bg-status-danger-bg/10 p-3 text-sm text-status-danger-text">
          {describeStatus(actionError.status)}：{actionError.message}
          {actionError.code ? `（${actionError.code}）` : ""}
        </div>
      )}
      <EntityDetailWorkspace
        stickyHeader
        title={`销售订单详情 — ${detail.code}`}
        backHref="/sales/orders"
        status={detail.status}
        statusLabel={salesStatusLabel("salesOrder", detail.status)}
        statusTone={salesStatusTone("salesOrder", detail.status)}
        actions={
          <>
            {detail.status === "DRAFT" && canEdit && (
              <Link
                href={`/sales/orders/${id}/edit`}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-primary hover:bg-canvas"
              >
                编辑
              </Link>
            )}
            {detail.status === "DRAFT" && canApprove && (
              <button
                type="button"
                onClick={() => setConfirmAction("confirm")}
                disabled={actionBusy}
                className={BUTTON_PRIMARY_CLASS}
              >
                {actionBusy ? "处理中…" : "确认订单"}
              </button>
            )}
            {(detail.status === "DRAFT" || detail.status === "CONFIRMED") && canClose && (
              <button
                type="button"
                onClick={() => setConfirmAction("cancel")}
                disabled={actionBusy}
                className="rounded-md border border-status-danger-border bg-surface px-3 py-1.5 text-sm font-medium text-status-danger-text hover:bg-status-danger-bg disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消订单
              </button>
            )}
            {canDeliver && canCreateDelivery && (
              <button
                type="button"
                onClick={openDeliveryDialog}
                disabled={actionBusy || remainingLines.length === 0}
                title={remainingLines.length === 0 ? "无剩余可交付数量" : undefined}
                className={BUTTON_PRIMARY_CLASS}
              >
                {actionBusy ? "创建中…" : "创建送货单"}
              </button>
            )}
          </>
        }
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem
              label="单号"
              value={
                <span className="inline-flex items-center gap-2">
                  {detail.code}
                  <CopyButton text={detail.code} size="sm" />
                </span>
              }
            />
            <InfoItem label="客户" value={detail.customer?.name} />
            <InfoItem
              label="来源报价单"
              value={
                detail.quotation ? (
                  <Link
                    href={`/sales/quotations/${detail.quotation.id}`}
                    className="text-brand-600 hover:underline"
                  >
                    {detail.quotation.code}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            <InfoItem label="下单日期" value={formatDate(detail.orderDate)} />
            <InfoItem
              label="期望交期"
              value={
                detail.requestedDeliveryDate ? formatDate(detail.requestedDeliveryDate) : "—"
              }
            />
            <InfoItem label="币种" value={detail.currency} />
            <InfoItem
              label="付款条件"
              value={detail.paymentTerm ? detail.paymentTerm : "—"}
            />
            <InfoItem label="贸易术语" value={detail.incoterm ? detail.incoterm : "—"} />
            <InfoItem label="含税合计" value={formatMoney(detail.totalAmount, detail.currency)} />
            <InfoItem label="备注" value={detail.remark} />
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
          </div>
        }
      >
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">
            明细行（{detail.lines?.length ?? 0}）
          </h2>
          <div className="overflow-x-auto">
            <table className="divide-border min-w-full divide-y text-sm">
              <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">行号</th>
                  <th className="px-3 py-2 font-medium">物料</th>
                  <th className="px-3 py-2 font-medium">描述</th>
                  <th className="px-3 py-2 text-right font-medium">数量</th>
                  <th className="px-3 py-2 text-right font-medium">已交付</th>
                  <th className="px-3 py-2 text-right font-medium">剩余可交付</th>
                  <th className="px-3 py-2 text-right font-medium">单价</th>
                  <th className="px-3 py-2 text-right font-medium">金额</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {(detail.lines ?? []).map((line) => (
                  <tr key={line.id}>
                    <td className="px-3 py-2 text-ink-secondary">{line.lineNo}</td>
                    <td className="px-3 py-2 text-ink-primary">
                      {line.item ? `${line.item.code ?? ""} ${line.item.name ?? ""}`.trim() : "—"}
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{line.description}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-primary">
                      {line.quantity}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-primary">
                      {line.deliveredQty ?? "0"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-primary">
                      {line.remainingQty ?? line.quantity}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                      {formatMoney(line.unitPrice, detail.currency)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-primary">
                      {formatMoney(line.totalAmount ?? "0", detail.currency)}
                    </td>
                  </tr>
                ))}
                {(detail.lines ?? []).length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-sm text-ink-muted">
                      暂无明细行
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── 履约回显：本订单创建的送货单及最新状态（confirm-delivery 聚合回写后刷新可见） ── */}
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">
            相关送货单（{detail.deliveries?.length ?? 0}）
          </h2>
          <div className="overflow-x-auto">
            <table className="divide-border min-w-full divide-y text-sm">
              <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">送货单号</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">库存出库</th>
                  <th className="px-3 py-2 text-right font-medium">行数</th>
                  <th className="px-3 py-2 font-medium">交付日期</th>
                  <th className="px-3 py-2 font-medium">创建时间</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {(detail.deliveries ?? []).map((dlv) => (
                  <tr key={dlv.id}>
                    <td className="px-3 py-2">
                      <Link
                        href={`/sales/deliveries/${dlv.id}`}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        {dlv.code}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge
                        status={dlv.status}
                        label={salesStatusLabel("delivery", dlv.status)}
                        tone={salesStatusTone("delivery", dlv.status)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      {dlv.status === "DISPATCHED" || dlv.status === "DELIVERED" ? (
                        <span className="text-xs font-medium text-status-success-text">已出库（库存已扣减）</span>
                      ) : (
                        <span className="text-xs text-ink-muted">未出库</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-primary">
                      {dlv._count?.lines ?? 0}
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{formatDate(dlv.deliveryDate)}</td>
                    <td className="px-3 py-2 text-ink-secondary">{formatDate(dlv.createdAt)}</td>
                  </tr>
                ))}
                {(detail.deliveries ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-sm text-ink-muted">
                      暂无送货单——确认订单后可从本页「创建送货单」生成
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </EntityDetailWorkspace>

      {/* Q 线：BOM 预计用料 + 推荐供应商（只读投影；独立 loading/error/retry，FRT-06） */}
      <section className="border-border bg-surface rounded-lg border p-4">
        <h2 className="text-ink-primary mb-3 text-sm font-semibold">BOM 预计用料（Q 线）</h2>
        {materialsLoading ? (
          <p className="text-ink-muted text-xs">正在加载配方用料…</p>
        ) : materialsError ? (
          <div role="alert" className="rounded-md border border-status-danger-border bg-status-danger-bg/10 p-3 text-sm text-status-danger-text">
            <p>
              {describeStatus(materialsError.status)}：{materialsError.message}
              {materialsError.code ? `（${materialsError.code}）` : ""}
            </p>
            <button
              type="button"
              onClick={retryProjections}
              className="mt-2 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-canvas"
            >
              重试
            </button>
          </div>
        ) : materials.length === 0 ? (
          <p className="text-ink-muted text-xs">无配方原料需求（订单行成品无 ACTIVE 配方）。</p>
        ) : (
          <>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-ink-muted border-border border-b text-xs">
                <th className="px-2 py-2">原料</th>
                <th className="px-2 py-2">原单位需求</th>
                <th className="px-2 py-2">折算吨数</th>
                <th className="px-2 py-2">当前库存</th>
                <th className="px-2 py-2">库存单位</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {materials.map((m) => (
                <tr key={m.itemId ?? m.itemCode ?? m.itemName ?? ""}>
                  <td className="px-2 py-2">{m.itemName ?? m.itemCode ?? "—"}</td>
                  <td className="px-2 py-2 tabular-nums">
                    {m.requiredQty.toFixed(4)} {m.requiredUom ?? m.uom ?? ""}
                  </td>
                  <td className="px-2 py-2 tabular-nums">
                    {m.tonnageConvertible && m.tonnage !== null ? (
                      `${m.tonnage.toFixed(3)} TON`
                    ) : (
                      <span
                        className="text-ink-muted"
                        title={m.reason ?? "未配置 → TON 换算"}
                      >
                        未换算
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 tabular-nums">{m.onHandQty}</td>
                  <td className="px-2 py-2">{m.uom ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(() => {
            // 吨数汇总只统计可换算项；未换算物料数明确提示（不造 0）
            const convertible = materials.filter(
              (m) => m.tonnageConvertible && m.tonnage !== null,
            );
            const totalTonnage = convertible.reduce((acc, m) => acc + (m.tonnage ?? 0), 0);
            const unconverted = materials.length - convertible.length;
            return (
              <p className="text-ink-secondary mt-3 text-xs">
                预计用料吨数合计（仅可换算项）：
                <span className="tabular-nums font-medium">
                  {totalTonnage.toFixed(3)} TON
                </span>
                {unconverted > 0 && (
                  <span className="text-status-warning-text">
                    （另有 {unconverted} 种原料未配置 → TON 换算，未计入合计）
                  </span>
                )}
              </p>
            );
          })()}
          </>
        )}
        <h2 className="text-ink-primary mt-4 mb-3 text-sm font-semibold">推荐供应商（Q 线）</h2>
        {suppliersLoading ? (
          <p className="text-ink-muted text-xs">正在加载推荐供应商…</p>
        ) : suppliersError ? (
          <div role="alert" className="rounded-md border border-status-danger-border bg-status-danger-bg/10 p-3 text-sm text-status-danger-text">
            <p>
              {describeStatus(suppliersError.status)}：{suppliersError.message}
              {suppliersError.code ? `（${suppliersError.code}）` : ""}
            </p>
            <button
              type="button"
              onClick={retryProjections}
              className="mt-2 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-canvas"
            >
              重试
            </button>
          </div>
        ) : !suppliers || suppliers.rows.length === 0 ? (
          <p className="text-ink-muted text-xs">暂无推荐供应商（订单行商品无 SupplierItem 关系）。</p>
        ) : (
          <>
            <p className="text-ink-muted mb-2 text-xs">{suppliers.basis}</p>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-ink-muted border-border border-b text-xs">
                  <th className="px-2 py-2">供应商</th>
                  <th className="px-2 py-2">供应商评级</th>
                  <th className="px-2 py-2">覆盖商品数</th>
                  <th className="px-2 py-2">优选数</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {suppliers.rows.map((s) => (
                  <tr key={s.supplierId ?? s.supplierName ?? ""}>
                    <td className="px-2 py-2">
                      {s.supplierName ?? s.supplierCode ?? "—"}
                      {s.preferredCount > 0 && (
                        <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">优选</span>
                      )}
                    </td>
                    <td className="px-2 py-2">{s.supplierRating ?? s.creditRating ?? "—"}</td>
                    <td className="px-2 py-2 tabular-nums">{s.itemCount}</td>
                    <td className="px-2 py-2 tabular-nums">{s.preferredCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {/* ── 创建送货单：source-selection dialog（partial delivery） ── */}
      {dialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
          onClick={closeDeliveryDialog}
        >
          <div
            className="border-border bg-surface shadow-elevation-lg flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-border flex items-center justify-between border-b px-5 py-3">
              <h2 className="text-ink-primary text-base font-semibold">创建送货单 — 选择交付行</h2>
              <span className="text-ink-muted text-xs">支持分批发货</span>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              <p className="text-ink-muted mb-3 text-xs">
                勾选要交付的行并填写数量（默认剩余可交付量，可改小）；至少选择一行。数量最终由后端锁内校验。
              </p>
              {dialogError && (
                <div className="border-status-danger-border mb-3 rounded-md border bg-status-danger-bg p-2 text-sm text-status-danger-text">
                  {dialogError}
                </div>
              )}
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
                  <tr>
                    <th className="px-3 py-2">选择</th>
                    <th className="px-3 py-2">行号</th>
                    <th className="px-3 py-2">物料</th>
                    <th className="px-3 py-2">剩余可交付</th>
                    <th className="px-3 py-2">本次数量</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {remainingLines.map((line) => {
                    const sel = selections[line.id];
                    const max = Number(line.remainingQty ?? line.quantity);
                    return (
                      <tr key={line.id} className={sel?.checked ? "" : "opacity-50"}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={sel?.checked ?? false}
                            onChange={(e) =>
                              updateSelection(line.id, { checked: e.target.checked })
                            }
                            className="h-4 w-4 accent-brand-600"
                          />
                        </td>
                        <td className="px-3 py-2 text-ink-secondary">{line.lineNo}</td>
                        <td className="px-3 py-2 text-ink-secondary">
                          {line.item ? `${line.item.code ?? ""} ${line.item.name ?? ""}`.trim() : "—"}
                        </td>
                        <td className="px-3 py-2 text-ink-secondary">{max}</td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={sel?.quantity ?? ""}
                            disabled={!sel?.checked}
                            onChange={(e) =>
                              updateSelection(line.id, { quantity: e.target.value })
                            }
                            className="focus:border-brand-500 w-28 rounded-md border border-border px-2 py-1.5 disabled:bg-canvas disabled:text-ink-muted"
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {remainingLines.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-sm text-ink-muted">
                        无剩余可交付数量
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="border-border flex justify-end gap-2 border-t px-5 py-3">
              <button
                type="button"
                onClick={closeDeliveryDialog}
                disabled={actionBusy}
                className={BUTTON_SECONDARY_CLASS}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleCreateDelivery}
                disabled={actionBusy}
                className={BUTTON_PRIMARY_CLASS}
              >
                {actionBusy ? "创建中…" : "创建送货单"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmActionDialog
        open={confirmAction !== null}
        title={confirmAction === "confirm" ? "确认销售订单" : "取消销售订单"}
        description={
          confirmAction === "confirm"
            ? "确认后将形成对客户的正式销售承诺（CONFIRMED），之后才可创建送货单。确认？"
            : "取消该销售订单？已交付/已完成的订单禁止取消。确认后不可恢复。"
        }
        confirmLabel={confirmAction === "confirm" ? "确认订单" : "确认取消"}
        tone={confirmAction === "cancel" ? "danger" : "primary"}
        busy={actionBusy}
        onConfirm={() => {
          const a = confirmAction;
          setConfirmAction(null);
          if (a) void runAction(a);
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("sales-order", "view")}>
      <SalesOrderDetailPage />
    </PermissionGuard>
  );
}