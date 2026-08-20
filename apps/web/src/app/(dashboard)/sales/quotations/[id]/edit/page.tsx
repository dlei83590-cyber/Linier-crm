"use client";

/**
 * Quotation Edit — 编辑报价单（F2-6B Sales Source-driven Actions，批 1）
 *
 * 契约（CTO #13286 锁定 + #13368 REQUEST CHANGES 修复）：
 * - 头 PATCH /api/quotations/:id：仅 {DRAFT, REJECTED} 可编辑；乐观锁 version CAS。
 *   nullable 字段支持清空：validFrom/validUntil/taxProfileId/remark 发送 null 即清空；
 *   只发送真正 changed 的字段（避免无条件生成无意义 Revision）。
 *   customer / currency / status / 来源单据 / 金额均不可从 Edit 表单修改。
 * - 行是独立 mutation contract（不是头 PATCH 全量替换）：
 *   POST   /api/quotations/:id/lines         新增行（quotation-line:create，仅 DRAFT/REJECTED）
 *   PATCH  /api/quotations/:id/lines/:lineId 改单行（quotation-line:edit，行 version CAS）
 *   DELETE /api/quotations/:id/lines/:lineId 删行（quotation-line:delete，软删 → 重算头合计 → Revision）
 *   description 发送当前值（空字符串即清空）。
 * - unitPrice / lineAmount / taxAmount / totalAmount = backend pricing facts，行 UI 只读，前端绝不发送。
 * - Dirty 按 mutation scope 隔离（headerDirty / lineDirtyIds / newLineDirty）：
 *   一个 scope 的 mutation 执行前，若存在其它 scope 未保存修改 → 阻止并提示；
 *   mutation 成功后重新 GET authoritative aggregate，对应 scope 的 dirty 才清除；
 *   VERSION_CONFLICT 重新载入成功后清对应 dirty，不 silent retry。
 * - 行级权限分别 Gate：Add→quotation-line:create / Save→quotation-line:edit / Delete→quotation-line:delete。
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { useSession } from "@/lib/session-context";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { CARD_CLASS } from "@/lib/ui-classes";
import { formatMoney } from "@/lib/format";

const EDITABLE_STATUSES = ["DRAFT", "REJECTED"] as const;

/** 状态中文业务名（Business UX Rationalization：枚举展示中文，不展示数据库枚举值；key 保留真实 enum） */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "已提交",
  APPROVED: "已批准",
  SENT: "已发送",
  ACCEPTED: "客户已接受",
  REJECTED: "已拒绝",
  CANCELLED: "已取消",
  CONVERTED: "已转订单",
  EXPIRED: "已过期",
};

interface ItemOption {
  id: string;
  code: string | null;
  name: string | null;
  stockUom?: { id: string; code: string | null; symbol: string | null } | null;
}

interface TaxProfileOption {
  id: string;
  code: string | null;
  name: string | null;
}

interface QuotationLine {
  id: string;
  version: number;
  lineNo: number;
  itemId?: string | null;
  description: string;
  quantity: string;
  uomId?: string | null;
  unitPrice: string;
  lineAmount: string;
  taxAmount: string;
  totalAmount: string;
  item?: { id: string; code: string | null; name: string | null; model?: string | null } | null;
}

interface QuotationDetail {
  id: string;
  code: string;
  status: string;
  effectiveStatus?: string;
  version: number;
  validFrom?: string | null;
  validUntil?: string | null;
  taxProfileId?: string | null;
  remark?: string | null;
  currency: string;
  totalAmount: string;
  customer?: { id: string; code: string | null; name: string | null } | null;
  lines?: QuotationLine[];
  createdAt: string;
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

function QuotationEditForm() {
  const params = useParams();
  const { state } = useSession();
  const id = typeof params.id === "string" ? params.id : "";

  const [items, setItems] = useState<ItemOption[]>([]);
  const [taxProfiles, setTaxProfiles] = useState<TaxProfileOption[]>([]);
  const [itemsError, setItemsError] = useState<ApiClientError | null>(null);
  const [taxProfilesError, setTaxProfilesError] = useState<ApiClientError | null>(null);
  const [detail, setDetail] = useState<QuotationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [notEditable, setNotEditable] = useState(false);

  // 头字段（仅业务输入；customer/currency/status/金额不可改）
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [taxProfileId, setTaxProfileId] = useState("");
  const [remark, setRemark] = useState("");
  // authoritative 初始值（用于 diff：只发 changed 字段 + nullable 清空语义）
  const [headerInit, setHeaderInit] = useState({
    validFrom: "",
    validUntil: "",
    taxProfileId: "",
    remark: "",
  });

  // 行编辑（pricing facts 只读）
  const [lines, setLines] = useState<QuotationLine[]>([]);
  const [lineDirtyIds, setLineDirtyIds] = useState<Set<string>>(new Set());
  const [newItemId, setNewItemId] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newQuantity, setNewQuantity] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canCreateLine = hasPermission(roles, actionPermission("quotation-line", "create"));
  const canEditLine = hasPermission(roles, actionPermission("quotation-line", "edit"));
  const canDeleteLine = hasPermission(roles, actionPermission("quotation-line", "delete"));

  // ── dirty scope 派生：header / lines / newLine ────────────────────────────
  const headerDirty =
    validFrom !== headerInit.validFrom ||
    validUntil !== headerInit.validUntil ||
    taxProfileId !== headerInit.taxProfileId ||
    remark !== headerInit.remark;
  const newLineDirty = newItemId !== "" || newDescription !== "" || newQuantity !== "";
  const anyDirty = headerDirty || lineDirtyIds.size > 0 || newLineDirty;

  const loadDetail = useCallback(async () => {
    try {
      const body = await apiFetch<QuotationDetail>(`/api/quotations/${id}`);
      setDetail(body.data);
      setValidFrom(toLocalInput(body.data.validFrom));
      setValidUntil(toLocalInput(body.data.validUntil));
      setTaxProfileId(body.data.taxProfileId ?? "");
      setRemark(body.data.remark ?? "");
      setHeaderInit({
        validFrom: toLocalInput(body.data.validFrom),
        validUntil: toLocalInput(body.data.validUntil),
        taxProfileId: body.data.taxProfileId ?? "",
        remark: body.data.remark ?? "",
      });
      setLines(body.data.lines ?? []);
      setLineDirtyIds(new Set());
      setNewItemId("");
      setNewDescription("");
      setNewQuantity("");
      if (!(EDITABLE_STATUSES as readonly string[]).includes(body.data.status)) {
        setNotEditable(true);
      }
    } catch (err: unknown) {
      setError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "加载失败", "NETWORK_ERROR"),
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  // 独立加载基础数据：Items 失败 → 阻断行编辑；Tax Profiles 失败 → 仅税档 selector 降级（页面其余仍可编辑）
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<ItemOption[]>("/api/items?pageSize=100", { signal: controller.signal })
      .then((body) => setItems(body.data))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setItemsError(
          err instanceof ApiClientError ? err : new ApiClientError(0, "加载物料失败", "NETWORK_ERROR"),
        );
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<TaxProfileOption[]>("/api/tax-profiles?pageSize=100", { signal: controller.signal })
      .then((body) => setTaxProfiles(body.data))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setTaxProfilesError(
          err instanceof ApiClientError
            ? err
            : new ApiClientError(0, "税率档案加载失败", "NETWORK_ERROR"),
        );
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    if (!anyDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [anyDirty]);

  // ── 跨 scope 阻止：执行某 scope mutation 前，其它 scope 有未保存修改则阻止 ──
  const blockIfOtherScopeDirty = (scope: "header" | "line" | "newLine"): boolean => {
    if (scope !== "header" && headerDirty) {
      setFieldErrors({ scope: "请先保存或放弃头字段的未保存修改" });
      return true;
    }
    if (scope !== "newLine" && newLineDirty) {
      setFieldErrors({ scope: "请先保存或放弃新增行的未保存修改" });
      return true;
    }
    if (scope !== "line" && lineDirtyIds.size > 0) {
      setFieldErrors({ scope: "请先保存或放弃明细行的未保存修改" });
      return true;
    }
    return false;
  };

  // ── 头字段 Save → PATCH /api/quotations/:id（detail.version CAS；只发 changed） ──
  const saveHeader = async () => {
    if (!detail || submitting) return;
    if (blockIfOtherScopeDirty("header")) return;

    // 只发送真正 changed 的字段；nullable 字段清空 → null
    const changes: Record<string, unknown> = {};
    if (validFrom !== headerInit.validFrom) changes.validFrom = toIso(validFrom);
    if (validUntil !== headerInit.validUntil) changes.validUntil = toIso(validUntil);
    if (taxProfileId !== headerInit.taxProfileId) changes.taxProfileId = taxProfileId || null;
    if (remark !== headerInit.remark) changes.remark = remark.trim() === "" ? null : remark;
    if (Object.keys(changes).length === 0) {
      setFieldErrors({ scope: "头字段没有修改" });
      return;
    }

    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      await apiFetch(`/api/quotations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: detail.version,
          ...changes,
          changeReason: "编辑报价单头字段",
        }),
      });
      await loadDetail(); // authoritative re-GET；成功后 headerInit 同步 → headerDirty 自动清
    } catch (err: unknown) {
      setError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "保存失败", "NETWORK_ERROR"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ── 新增行 → POST /lines（前端绝不发送 unitPrice） ────────────────────────
  const addLine = async () => {
    if (submitting) return;
    if (blockIfOtherScopeDirty("newLine")) return;
    if (!newItemId) {
      setFieldErrors({ newLine: "请选择物料" });
      return;
    }
    const qty = Number(newQuantity);
    if (!newQuantity || !(qty > 0)) {
      setFieldErrors({ newLine: "数量必须大于 0" });
      return;
    }
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const item = items.find((it) => it.id === newItemId);
      await apiFetch(`/api/quotations/${id}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: newItemId,
          ...(newDescription ? { description: newDescription } : {}),
          quantity: qty,
          ...(item?.stockUom?.id ? { uomId: item.stockUom.id } : {}),
        }),
      });
      await loadDetail(); // authoritative re-GET；成功后新增行表单与 dirty 一并重置
    } catch (err: unknown) {
      setError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "添加行失败", "NETWORK_ERROR"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ── 改单行 → PATCH /lines/:lineId（line.version CAS；description 发当前值） ──
  const updateLineField = (idx: number, patch: Partial<QuotationLine>) => {
    setLines((prev) => {
      const next = prev.map((l, i) => (i === idx ? { ...l, ...patch } : l));
      setLineDirtyIds((prevIds) => new Set(prevIds).add(next[idx].id));
      return next;
    });
  };

  const saveLine = async (line: QuotationLine) => {
    if (submitting) return;
    if (blockIfOtherScopeDirty("line")) return;
    if (lineDirtyIds.size > 1 || (lineDirtyIds.size === 1 && !lineDirtyIds.has(line.id))) {
      setFieldErrors({ scope: "请先保存或放弃其它明细行的未保存修改" });
      return;
    }
    const qty = Number(line.quantity);
    if (!line.quantity || !(qty > 0)) {
      setFieldErrors({ [`line.${line.id}`]: "数量必须大于 0" });
      return;
    }
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      await apiFetch(`/api/quotations/${id}/lines/${line.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: line.description, // 发送当前值（空字符串即清空）
          quantity: qty,
          changeReason: "编辑报价单行",
          version: line.version,
        }),
      });
      await loadDetail(); // authoritative re-GET；成功后该行 dirty 清除
    } catch (err: unknown) {
      setError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "保存行失败", "NETWORK_ERROR"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ── 删行 → DELETE /lines/:lineId（软删，无 version CAS） ───────────────────
  const deleteLine = async (line: QuotationLine) => {
    if (submitting) return;
    if (blockIfOtherScopeDirty("line")) return;
    if (lineDirtyIds.size > 1 || (lineDirtyIds.size === 1 && !lineDirtyIds.has(line.id))) {
      setFieldErrors({ scope: "请先保存或放弃其它明细行的未保存修改" });
      return;
    }
    if (!window.confirm(`确定删除第 ${line.lineNo} 行？该操作不可撤销。`)) return;
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      await apiFetch(`/api/quotations/${id}/lines/${line.id}`, {
        method: "DELETE",
      });
      await loadDetail();
    } catch (err: unknown) {
      setError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "删除行失败", "NETWORK_ERROR"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm text-ink-muted">
        加载中…
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="rounded-lg border border-status-danger-border bg-status-danger-bg p-6 text-sm text-status-danger-text">
        {describeStatus(error.status)}：{error.message}
        {error.code ? `（${error.code}）` : ""}
        <div className="mt-3">
          <Link href={`/sales/quotations/${id}`} className="text-brand-600 hover:underline">
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
          <h1 className="text-lg font-semibold text-ink-primary">编辑报价单 — {detail.code}</h1>
          <Link
            href={`/sales/quotations/${id}`}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-canvas"
          >
            返回详情
          </Link>
        </div>
        <div className="p-6">
          <p className="text-sm text-status-warning-text">
            仅 草稿 / 已拒绝 状态可编辑（当前 {STATUS_LABELS[detail.status] ?? detail.status}）——已提交/已接受/已转换的报价单不可修改。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center justify-between border-b border-border p-4">
        <h1 className="text-lg font-semibold text-ink-primary">
          编辑报价单 — {detail?.code}
          <span className="ml-2 text-xs font-normal text-ink-muted">
            {STATUS_LABELS[detail?.status ?? ""] ?? detail?.status}（v{detail?.version}）
          </span>
        </h1>
        <div className="flex items-center gap-2">
          {anyDirty && <span className="text-xs text-status-warning-text">有未保存的更改</span>}
          <Link
            href={`/sales/quotations/${id}`}
            onClick={(e) => {
              if (anyDirty && !window.confirm("有未保存的更改，确定离开？")) e.preventDefault();
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
                <p className="text-xs">
                  数据已被他人修改（VERSION_CONFLICT），未保存的更改可能丢失。重新载入最新数据后请重新确认修改。
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("未保存的更改将丢失，确定重新载入最新数据？")) {
                      setError(null);
                      setNotEditable(false);
                      loadDetail(); // 成功后各 scope 初始值/列表重置 → dirty 全部清除
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

        {/* ── 头字段（只读展示 customer/currency/status；仅编辑业务输入） ── */}
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
            <p className="mt-1 text-ink-secondary">
              {formatMoney(detail?.totalAmount ?? "0", detail?.currency ?? "CNY")}
            </p>
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">有效期从（可选，清空即置空）</label>
            <input
              type="datetime-local"
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">有效期至（可选，清空即置空）</label>
            <input
              type="datetime-local"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">税率档案（可选，可清空）</label>
            <select
              value={taxProfileId}
              onChange={(e) => setTaxProfileId(e.target.value)}
              disabled={!!taxProfilesError}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none disabled:bg-canvas disabled:text-ink-muted"
            >
              <option value="">未指定</option>
              {taxProfiles.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code ?? ""} {t.name ?? ""}
                </option>
              ))}
            </select>
            {taxProfilesError && (
              <p className="mt-1 text-xs text-status-warning-text">
                税率档案加载失败（已保留当前值，保存不会清空税档）
              </p>
            )}
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

        <div className="mb-3">
          <button
            type="button"
            onClick={saveHeader}
            disabled={submitting}
            className="bg-brand-600 hover:bg-brand-700 rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "保存中…" : "保存头字段"}
          </button>
        </div>

        {/* ── 明细行：description/quantity 可编辑；pricing facts 只读 ── */}
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink-secondary">
            报价明细（{lines.length}）——单价/金额为后端定价快照，只读
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
              <tr>
                <th className="px-3 py-2">行号</th>
                <th className="px-3 py-2">物料（只读）</th>
                <th className="px-3 py-2">描述</th>
                <th className="px-3 py-2">数量</th>
                <th className="px-3 py-2">单价（只读）</th>
                <th className="px-3 py-2">含税金额（只读）</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((line, idx) => {
                const lineDirty = lineDirtyIds.has(line.id);
                return (
                  <tr key={line.id}>
                    <td className="px-3 py-2 text-ink-secondary">{line.lineNo}</td>
                    <td className="px-3 py-2 text-ink-secondary">
                      {line.item ? `${line.item.code ?? ""} ${line.item.name ?? ""}`.trim() : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={line.description}
                        disabled={!canEditLine}
                        onChange={(e) => updateLineField(idx, { description: e.target.value })}
                        placeholder="可选"
                        maxLength={500}
                        className="focus:border-brand-500 w-full min-w-40 rounded-md border border-border px-2 py-1.5 focus:outline-none disabled:bg-canvas disabled:text-ink-muted"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={line.quantity}
                        disabled={!canEditLine}
                        onChange={(e) => updateLineField(idx, { quantity: e.target.value })}
                        className="focus:border-brand-500 w-24 rounded-md border border-border px-2 py-1.5 focus:outline-none disabled:bg-canvas disabled:text-ink-muted"
                      />
                      {fieldErrors[`line.${line.id}`] && (
                        <p className="mt-0.5 text-xs text-status-danger-text">
                          {fieldErrors[`line.${line.id}`]}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">
                      {formatMoney(line.unitPrice, detail?.currency ?? "CNY")}
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">
                      {formatMoney(line.totalAmount, detail?.currency ?? "CNY")}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        {canEditLine && (
                          <button
                            type="button"
                            onClick={() => saveLine(line)}
                            disabled={submitting}
                            className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            保存
                          </button>
                        )}
                        {canDeleteLine && (
                          <button
                            type="button"
                            onClick={() => deleteLine(line)}
                            disabled={submitting}
                            className="rounded-md border border-status-danger-border px-2 py-1 text-xs text-status-danger-text hover:bg-status-danger-bg disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            删除
                          </button>
                        )}
                      </div>
                      {lineDirty && (
                        <p className="mt-0.5 text-xs text-status-warning-text">该行有未保存修改</p>
                      )}
                    </td>
                  </tr>
                );
              })}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-ink-muted">
                    暂无明细行
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── 新增行（POST /lines；不发送 unitPrice；quotation-line:create Gate） ── */}
        {canCreateLine ? (
          <div className="mt-4 rounded-md border border-dashed border-slate-300 p-3">
            <p className="mb-2 text-xs font-medium text-ink-secondary">新增行</p>
            {itemsError ? (
              <p className="text-sm text-status-danger-text">
                物料数据加载失败，暂时无法新增行：{describeStatus(itemsError.status)}：{itemsError.message}
                {itemsError.code ? `（${itemsError.code}）` : ""}
              </p>
            ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div>
                <select
                  value={newItemId}
                  onChange={(e) => setNewItemId(e.target.value)}
                  className="focus:border-brand-500 w-full rounded-md border border-border px-2 py-1.5 text-sm focus:outline-none"
                >
                  <option value="">选择物料</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.code ?? ""} {it.name ?? ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <input
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="描述（可选）"
                  maxLength={500}
                  className="focus:border-brand-500 w-full rounded-md border border-border px-2 py-1.5 text-sm focus:outline-none"
                />
              </div>
              <div>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={newQuantity}
                  onChange={(e) => setNewQuantity(e.target.value)}
                  placeholder="数量 *"
                  className="focus:border-brand-500 w-full rounded-md border border-border px-2 py-1.5 text-sm focus:outline-none"
                />
              </div>
              <div>
                <button
                  type="button"
                  onClick={addLine}
                  disabled={submitting}
                  className="bg-brand-600 hover:bg-brand-700 w-full rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  + 添加行
                </button>
              </div>
            </div>
            )}
            {fieldErrors.newLine && (
              <p className="mt-1 text-xs text-status-danger-text">{fieldErrors.newLine}</p>
            )}
          </div>
        ) : (
          <p className="mt-3 text-xs text-ink-muted">无新增行权限（quotation-line:create）</p>
        )}

        {anyDirty && <span className="mt-3 block text-xs text-status-warning-text">有未保存的更改</span>}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("quotation", "edit")}>
      <QuotationEditForm />
    </PermissionGuard>
  );
}