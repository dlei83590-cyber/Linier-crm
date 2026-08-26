"use client";

/**
 * Purchase Requisitions — 采购申请详情页（F2-3 Batch C1 Consolidation，CTO #11888）
 *
 * 由旧式布局迁移至统一 Workspace：
 * AppPage → EntityDetailWorkspace（Header Summary → Status → Actions → Sections → Audit）。
 * 不改 backend / 状态机 / action；apiFetch 数据加载原样保留。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, ConfirmActionDialog, EntityDetailWorkspace, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS } from "@/lib/ui-classes";
import { formatDate } from "@/lib/format";

/** 状态中文业务名（Business UX Rationalization：枚举展示中文，不展示数据库枚举值；key 保留真实 enum） */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "已提交",
  APPROVED: "已批准",
  CONVERTED: "已转采购订单",
  CANCELLED: "已取消",
};

interface RequisitionDetail {
  id: string;
  code: string;
  status: string;
  remark?: string | null;
  needDate?: string | null;
  createdAt: string;
  requester?: { name: string | null } | null;
  department?: { name: string | null } | null;
  lines?: Array<{
    id: string;
    lineNo: number;
    description: string;
    quantity: string;
    needDate?: string | null;
    item?: { id: string; code: string | null; name: string | null } | null;
    uom?: { symbol: string | null } | null;
  }>;
}

/** 价格通道（对齐 PO 双通道枚举；无供应商快照时强制 MANUAL） */
type ConvertPriceSource = "SUPPLIER_PRICE_SNAPSHOT" | "MANUAL";

/** 转单对话框每行价格状态 */
interface ConvertLineRow {
  lineId: string;
  lineNo: number;
  description: string;
  quantity: string;
  itemLabel: string;
  uomSymbol: string;
  hasItem: boolean;
  snapshot: { partnerPriceId: string; unitPrice: string; taxRate: string } | null;
  // 商品优选供应商行采购信息（用户指令 2026-08-21：无快照时预填商品采购价；供应商/付款条款自动带出）
  itemSupplierId: string | null;
  itemPurchasePrice: string | null;
  itemPaymentTerm: string | null;
  priceSource: ConvertPriceSource;
  unitPrice: string;
  priceReason: string;
}

const PRICE_SOURCE_OPTIONS: Array<{ value: ConvertPriceSource; label: string }> = [
  { value: "SUPPLIER_PRICE_SNAPSHOT", label: "供应商价格快照" },
  { value: "MANUAL", label: "手工定价" },
];

/** 本地今日 YYYY-MM-DD（date 输入默认值；用户指令 2026-08-21：全站日期默认今天） */
function todayInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
}

function RequisitionDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const { state } = useSession();
  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canEdit = hasPermission(roles, actionPermission("purchase-requisition", "edit"));
  const canApprove = hasPermission(roles, actionPermission("purchase-requisition", "approve"));
  const [detail, setDetail] = useState<RequisitionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiClientError | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; code: string | null; name: string | null; partner?: { id: string } | null }>>([]);
  const [convertSupplierId, setConvertSupplierId] = useState("");
  const [convertDeliveryDate, setConvertDeliveryDate] = useState(todayInput);
  const [convertPaymentTerm, setConvertPaymentTerm] = useState("");
  const [convertRemark, setConvertRemark] = useState("");
  const [convertError, setConvertError] = useState<string | null>(null);
  const [convertLines, setConvertLines] = useState<ConvertLineRow[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [commercialTerms, setCommercialTerms] = useState<Array<{ id: string; code: string; name: string }>>([]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<RequisitionDetail>(`/api/purchase-requisitions/${id}`, { signal: controller.signal })
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
    return () => controller.abort();
  }, [id]);

  const refreshDetail = async () => {
    try {
      const body = await apiFetch<RequisitionDetail>(`/api/purchase-requisitions/${id}`);
      setDetail(body.data);
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "刷新失败", "NETWORK_ERROR"),
      );
    }
  };

  const handleSubmit = async () => {
    if (!detail || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await apiFetch(`/api/purchase-requisitions/${id}/submit`, { method: "POST" });
      await refreshDetail();
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "提交失败", "NETWORK_ERROR"),
      );
    } finally {
      setActionBusy(false);
    }
  };

  const openConvertDialog = async () => {
    setConvertOpen(true);
    setConvertError(null);
    setConvertSupplierId("");
    setConvertDeliveryDate("");
    setConvertPaymentTerm("");
    setConvertRemark("");
    setConvertLines([]);
    try {
      const body = await apiFetch<Array<{ id: string; code: string | null; name: string | null; partner?: { id: string } | null }>>("/api/suppliers?pageSize=100");
      setSuppliers(body.data);
      const termBody = await apiFetch<Array<{ id: string; code: string; name: string }>>("/api/commercial-terms?pageSize=100");
      setCommercialTerms(termBody.data);
    } catch {
      setConvertError("加载供应商/商业条款失败");
    }
  };

  /** 按供应商解析每行价格通道（服务端权威：resolveSupplierPriceSnapshot 语义） */
  const loadConvertSuggestions = async (supplierId: string) => {
    setSuggestLoading(true);
    setConvertError(null);
    try {
      const body = await apiFetch<{
        lines: Array<{
          lineId: string;
          lineNo: number;
          itemId: string | null;
          itemCode: string | null;
          itemName: string | null;
          description: string;
          quantity: string;
          uomSymbol: string | null;
          snapshot: { partnerPriceId: string; unitPrice: string; taxRate: string } | null;
          itemSupplierId: string | null;
          itemPurchasePrice: string | null;
          itemPaymentTerm: string | null;
        }>;
      }>(`/api/purchase-requisitions/${id}/price-suggestions?supplierId=${encodeURIComponent(supplierId)}`);
      setConvertLines(
        body.data.lines.map((l) => ({
          lineId: l.lineId,
          lineNo: l.lineNo,
          description: l.description,
          quantity: l.quantity,
          itemLabel: [l.itemCode, l.itemName].filter(Boolean).join(" ") || "—",
          uomSymbol: l.uomSymbol ?? "—",
          hasItem: Boolean(l.itemId),
          snapshot: l.snapshot,
          itemSupplierId: l.itemSupplierId,
          itemPurchasePrice: l.itemPurchasePrice,
          itemPaymentTerm: l.itemPaymentTerm,
          // 有快照默认快照通道；无快照 / 无 itemId → 强制 MANUAL（避免 convert 409 PURCHASE_ORDER_PRICE_NOT_FOUND 死胡同）
          priceSource: l.snapshot ? "SUPPLIER_PRICE_SNAPSHOT" : "MANUAL",
          // 无快照且有商品默认采购价 → 预填单价+依据（自动引用商品采购价）
          unitPrice: l.snapshot || !l.itemPurchasePrice ? "" : String(l.itemPurchasePrice),
          priceReason: l.snapshot || !l.itemPurchasePrice ? "" : "商品默认采购价",
        })),
      );
      // 付款条款自动带出：对话框未设置 && 某行商品有默认付款条款（用户指令 2026-08-21）
      setConvertPaymentTerm((prev) => {
        if (prev) return prev;
        const first = body.data.lines.find((l) => l.itemPaymentTerm);
        return first?.itemPaymentTerm ?? "";
      });
      // 默认供应商自动预选：对话框未选 && 某行商品优选供应商（SupplierItem.supplierId=BP → Supplier.partner 映射）
      setConvertSupplierId((prev) => {
        if (prev) return prev;
        const first = body.data.lines.find((l) => l.itemSupplierId);
        if (!first?.itemSupplierId) return prev;
        const s = suppliers.find((it) => it.partner?.id === first.itemSupplierId);
        return s?.id ?? prev;
      });
    } catch (err: unknown) {
      setConvertError(err instanceof ApiClientError ? err.message : "加载价格通道建议失败");
    } finally {
      setSuggestLoading(false);
    }
  };

  const updateConvertLine = (index: number, patch: Partial<ConvertLineRow>) => {
    setConvertLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };

  const handleConvert = async () => {
    if (!detail || actionBusy) return;
    if (!convertSupplierId) {
      setConvertError("请选择供应商");
      return;
    }
    if (convertLines.length === 0) {
      setConvertError("请选择供应商并等待价格通道加载完成");
      return;
    }
    // UX 层校验（领域事实以服务端为准；MANUAL 必填 unitPrice>0 + priceReason；priceSetBy/priceSetAt 由 convert 服务端写入审计）
    for (let i = 0; i < convertLines.length; i += 1) {
      const l = convertLines[i];
      if (l.priceSource === "MANUAL") {
        const p = Number(l.unitPrice);
        if (!l.unitPrice || !Number.isFinite(p) || p <= 0) {
          setConvertError(`第 ${i + 1} 行：手工定价单价必须 > 0`);
          return;
        }
        if (!l.priceReason.trim()) {
          setConvertError(`第 ${i + 1} 行：手工定价必须填写价格依据`);
          return;
        }
      }
    }
    setActionBusy(true);
    setActionError(null);
    setConvertError(null);
    try {
      const body = await apiFetch<{ id: string; code: string; status: string }>(
        `/api/purchase-requisitions/${id}/convert`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supplierId: convertSupplierId,
            ...(convertDeliveryDate ? { expectedDeliveryDate: new Date(convertDeliveryDate).toISOString() } : {}),
            ...(convertPaymentTerm.trim() ? { paymentTerm: convertPaymentTerm.trim() } : {}),
            ...(convertRemark.trim() ? { remark: convertRemark.trim() } : {}),
            // 价格双通道：按 PR 行序传 per-line 通道（快照服务端解析 / MANUAL 授权录入 + priceReason 审计）
            lines: convertLines.map((l) => ({
              priceSource: l.priceSource,
              ...(l.priceSource === "MANUAL"
                ? { unitPrice: Number(l.unitPrice), priceReason: l.priceReason.trim() }
                : {}),
            })),
          }),
        },
      );
      setConvertOpen(false);
      await refreshDetail();
      if (body.data.id) {
        window.location.href = `/purchasing/orders/${body.data.id}`;
      }
    } catch (err: unknown) {
      // 失败保留在对话框内展示（含 409 PURCHASE_ORDER_PRICE_NOT_FOUND 等业务冲突）
      setConvertError(err instanceof ApiClientError ? err.message : "转单失败");
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) {
    return (
      <AppPage>
        <div className="border-border bg-surface rounded-lg border p-6 text-sm text-ink-muted">
          加载中…
        </div>
      </AppPage>
    );
  }

  if (error || !detail) {
    return (
      <AppPage>
        <ErrorPanel error={error} />
        <Link href="/purchasing/requisitions" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
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
        title={`采购申请详情 — ${detail.code}`}
        backHref="/purchasing/requisitions"
        status={detail.status}
        statusLabel={STATUS_LABELS[detail.status] ?? detail.status}
        actions={
          <>
            {detail.status === "DRAFT" && canEdit && (
              <>
                <Link
                  href={`/purchasing/requisitions/${id}/edit`}
                  className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-primary hover:bg-canvas"
                >
                  编辑
                </Link>
                <button
                  type="button"
                  onClick={() => setConfirmSubmit(true)}
                  disabled={actionBusy}
                  className={BUTTON_PRIMARY_CLASS}
                >
                  {actionBusy ? "处理中…" : "提交生效"}
                </button>
              </>
            )}
            {detail.status === "APPROVED" && canApprove && (
              <button
                type="button"
                onClick={openConvertDialog}
                disabled={actionBusy}
                className={BUTTON_PRIMARY_CLASS}
              >
                {actionBusy ? "处理中…" : "转采购订单"}
              </button>
            )}
          </>
        }
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="单号" value={detail.code} />
            <InfoItem label="申请人" value={detail.requester?.name} />
            <InfoItem label="部门" value={detail.department?.name} />
            <InfoItem label="需求日期" value={formatDate(detail.needDate)} />
            <InfoItem label="备注" value={detail.remark} />
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
                  <th className="px-3 py-2 font-medium">需求描述</th>
                  <th className="px-3 py-2 font-medium">数量</th>
                  <th className="px-3 py-2 font-medium">单位</th>
                  <th className="px-3 py-2 font-medium">需求日期</th>
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
                    <td className="px-3 py-2 text-ink-primary">{line.quantity}</td>
                    <td className="px-3 py-2 text-ink-secondary">{line.uom?.symbol ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{formatDate(line.needDate)}</td>
                  </tr>
                ))}
                {(detail.lines ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-sm text-ink-muted">
                      暂无明细行
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">审计信息</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
          </div>
        </section>
      </EntityDetailWorkspace>

      <ConfirmActionDialog
        open={confirmSubmit}
        title="提交采购申请审批"
        description="提交即生效（已自动批准），可继续转采购订单。确认提交？"
        confirmLabel="确认提交"
        busy={actionBusy}
        onConfirm={() => {
          setConfirmSubmit(false);
          void handleSubmit();
        }}
        onCancel={() => setConfirmSubmit(false)}
      />

      {/* ── 转采购订单对话框（选择供应商 + 可选头字段 + 按行价格通道：有快照自动采用 / 无快照强制 MANUAL 手工录入） ── */}
      {convertOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
          onClick={() => setConvertOpen(false)}
        >
          <div
            className="border-border bg-surface shadow-elevation-lg w-full max-w-2xl rounded-lg border p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-ink-primary text-base font-semibold">转采购订单</h2>
            <p className="text-ink-secondary mt-2 text-xs">
              将采购申请行复制为采购订单（DRAFT）。选择供应商后按行确认价格通道：有供应商价格快照自动采用；未配置的行必须手工录入单价与价格依据。
            </p>
            {convertError && (
              <div className="border-status-danger-border mt-3 rounded-md border bg-status-danger-bg p-2 text-sm text-status-danger-text">{convertError}</div>
            )}
            <div className="mt-4 space-y-3 text-sm">
              <div>
                <label className="block text-xs text-ink-secondary">供应商 *</label>
                <select
                  value={convertSupplierId}
                  onChange={(e) => {
                    const v = e.target.value;
                    setConvertSupplierId(v);
                    if (v) {
                      void loadConvertSuggestions(v);
                    } else {
                      setConvertLines([]);
                    }
                  }}
                  className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
                >
                  <option value="">选择供应商</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.code ?? ""} {s.name ?? ""}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-ink-secondary">期望交期（可选）</label>
                <input
                  type="date"
                  value={convertDeliveryDate}
                  onChange={(e) => setConvertDeliveryDate(e.target.value)}
                  className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-ink-secondary">付款条件（商业条款，可选）</label>
                <select
                  value={convertPaymentTerm}
                  onChange={(e) => setConvertPaymentTerm(e.target.value)}
                  className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
                >
                  <option value="">不设置</option>
                  {commercialTerms.map((t) => (
                    <option key={t.id} value={t.code}>
                      {t.code} {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-ink-secondary">备注（可选，≤1000）</label>
                <input
                  value={convertRemark}
                  onChange={(e) => setConvertRemark(e.target.value)}
                  maxLength={1000}
                  className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-4">
              <h3 className="text-ink-primary text-sm font-medium">行价格通道</h3>
              <p className="text-ink-secondary mt-1 text-xs">
                SUPPLIER_PRICE_SNAPSHOT：服务端从供应商专属价解析（priority 升序）；MANUAL：手工定价 + 价格依据（审计留痕）。
              </p>
              {suggestLoading ? (
                <p className="text-ink-muted mt-2 text-xs">正在加载价格通道建议…</p>
              ) : convertLines.length === 0 ? (
                <p className="text-ink-muted mt-2 text-xs">请先选择供应商，加载各行的价格通道建议。</p>
              ) : (
                <div className="mt-2 max-h-72 space-y-3 overflow-y-auto pr-1">
                  {convertLines.map((l, i) => (
                    <div key={l.lineId} className="border-border rounded-md border p-3">
                      <div className="text-xs">
                        <span className="font-medium text-ink-primary">第 {i + 1} 行</span>
                        <span className="text-ink-secondary"> · {l.itemLabel}</span>
                        <span className="text-ink-secondary"> · {l.description}</span>
                        <span className="text-ink-secondary">
                          {" "}· 数量 {l.quantity}{l.uomSymbol !== "—" ? ` ${l.uomSymbol}` : ""}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-start gap-3">
                        <div>
                          <label className="text-ink-secondary block text-xs">价格通道</label>
                          <select
                            value={l.priceSource}
                            disabled={!l.snapshot}
                            onChange={(e) => updateConvertLine(i, { priceSource: e.target.value as ConvertPriceSource })}
                            className="focus:border-brand-500 mt-1 rounded-md border border-border px-3 py-1.5 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {PRICE_SOURCE_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                          {!l.snapshot && (
                            <p className="border-status-warning-border bg-status-warning-bg text-status-warning-text mt-1 rounded border px-2 py-1 text-xs">
                              未配置供应商价格快照，请手工录入
                            </p>
                          )}
                        </div>
                        {l.priceSource === "SUPPLIER_PRICE_SNAPSHOT" && l.snapshot && (
                          <div className="text-ink-secondary mt-4 text-xs">
                            快照价 ¥{l.snapshot.unitPrice}（税率 {l.snapshot.taxRate}%）
                          </div>
                        )}
                        {l.priceSource === "MANUAL" && (
                          <>
                            <div>
                              <label className="text-ink-secondary block text-xs">手工单价 *</label>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={l.unitPrice}
                                onChange={(e) => updateConvertLine(i, { unitPrice: e.target.value })}
                                placeholder="> 0"
                                className="focus:border-brand-500 mt-1 w-28 rounded-md border border-border px-3 py-1.5 focus:outline-none"
                              />
                            </div>
                            <div className="min-w-[180px] flex-1">
                              <label className="text-ink-secondary block text-xs">价格依据 *</label>
                              <input
                                type="text"
                                value={l.priceReason}
                                maxLength={500}
                                onChange={(e) => updateConvertLine(i, { priceReason: e.target.value })}
                                placeholder="如：供应商报价单 / 询价记录 / 上次采购价"
                                className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConvertOpen(false)}
                disabled={actionBusy}
                className="border-border text-ink-secondary rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConvert}
                disabled={actionBusy || suggestLoading}
                className="bg-brand-600 hover:bg-brand-700 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionBusy ? "转单中…" : "确认转单"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.PURCHASE_REQUISITION_READ}>
      <RequisitionDetailPage />
    </PermissionGuard>
  );
}