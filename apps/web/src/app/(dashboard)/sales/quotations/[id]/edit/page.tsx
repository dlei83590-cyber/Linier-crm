"use client";

/**
 * Quotation Edit — 编辑报价单（F2-6B Sales Source-driven Actions，批 1）
 *
 * 契约（CTO #13286 锁定，Review Blocking 规则）：
 * - 头 PATCH /api/quotations/:id：仅 {DRAFT, REJECTED} 可编辑；乐观锁 version CAS；
 *   body = { version, validFrom?, validUntil?, taxProfileId?, remark?, changeReason? }
 *   customer / currency / status / 来源单据 / 金额均不可从 Edit 表单修改。
 * - 行是独立 mutation contract（不是头 PATCH 全量替换）：
 *   POST   /api/quotations/:id/lines         新增行（quotation-line:create，仅 DRAFT/REJECTED）
 *   PATCH  /api/quotations/:id/lines/:lineId 改单行（quotation-line:edit，行 version CAS）
 *   DELETE /api/quotations/:id/lines/:lineId 删行（quotation-line:delete，软删 → 重算头合计 → Revision）
 * - unitPrice / lineAmount / taxAmount / totalAmount = backend pricing facts，行 UI 只读，前端绝不发送。
 * - 每次 mutation 成功后重新 GET authoritative aggregate（不本地计算金额或版本）。
 * - VERSION_CONFLICT → stale panel / reload，不 silent retry。
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";

const EDITABLE_STATUSES = ["DRAFT", "REJECTED"] as const;

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

function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function QuotationEditForm() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";

  const [items, setItems] = useState<ItemOption[]>([]);
  const [taxProfiles, setTaxProfiles] = useState<TaxProfileOption[]>([]);
  const [detail, setDetail] = useState<QuotationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [notEditable, setNotEditable] = useState(false);

  // 头字段（仅业务输入；customer/currency/status/金额不可改）
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [taxProfileId, setTaxProfileId] = useState("");
  const [remark, setRemark] = useState("");

  // 行编辑（pricing facts 只读）
  const [lines, setLines] = useState<QuotationLine[]>([]);
  const [newItemId, setNewItemId] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newQuantity, setNewQuantity] = useState("");

  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const loadDetail = useCallback(async () => {
    try {
      const body = await apiFetch<QuotationDetail>(`/api/quotations/${id}`);
      setDetail(body.data);
      setValidFrom(toLocalInput(body.data.validFrom));
      setValidUntil(toLocalInput(body.data.validUntil));
      setTaxProfileId(body.data.taxProfileId ?? "");
      setRemark(body.data.remark ?? "");
      setLines(body.data.lines ?? []);
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

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiFetch<ItemOption[]>("/api/items?pageSize=100", { signal: controller.signal }),
      apiFetch<TaxProfileOption[]>("/api/tax-profiles?pageSize=100", { signal: controller.signal }),
    ])
      .then(([itemsBody, taxBody]) => {
        setItems(itemsBody.data);
        setTaxProfiles(taxBody.data);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof ApiClientError
            ? err
            : new ApiClientError(0, "加载基础数据失败", "NETWORK_ERROR"),
        );
      });
    return () => controller.abort();
  }, []);

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

  const markDirty = () => setDirty(true);

  // ── 头字段 Save → PATCH /api/quotations/:id（detail.version CAS） ──────────
  const saveHeader = async () => {
    if (!detail) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/api/quotations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: detail.version,
          ...(validFrom ? { validFrom: toIso(validFrom) } : {}),
          ...(validUntil ? { validUntil: toIso(validUntil) } : {}),
          ...(taxProfileId ? { taxProfileId } : {}),
          ...(remark ? { remark } : {}),
          changeReason: "编辑报价单头字段",
        }),
      });
      setDirty(false);
      await loadDetail();
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
      setNewItemId("");
      setNewDescription("");
      setNewQuantity("");
      setDirty(false);
      await loadDetail();
    } catch (err: unknown) {
      setError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "添加行失败", "NETWORK_ERROR"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ── 改单行 → PATCH /lines/:lineId（line.version CAS） ──────────────────────
  const updateLineField = (idx: number, patch: Partial<QuotationLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    markDirty();
  };

  const saveLine = async (line: QuotationLine) => {
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
          ...(line.description ? { description: line.description } : {}),
          quantity: qty,
          changeReason: "编辑报价单行",
          version: line.version,
        }),
      });
      setDirty(false);
      await loadDetail();
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
    if (!window.confirm(`确定删除第 ${line.lineNo} 行？该操作不可撤销。`)) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/api/quotations/${id}/lines/${line.id}`, {
        method: "DELETE",
      });
      setDirty(false);
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
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-400">
        加载中…
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-red-700">
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
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h1 className="text-lg font-semibold text-slate-800">编辑报价单 — {detail.code}</h1>
          <Link
            href={`/sales/quotations/${id}`}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            返回详情
          </Link>
        </div>
        <div className="p-6">
          <p className="text-sm text-amber-600">
            仅 DRAFT / REJECTED 状态可编辑（当前 {detail.status}）——已提交/已接受/已转换的报价单不可修改。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 p-4">
        <h1 className="text-lg font-semibold text-slate-800">
          编辑报价单 — {detail?.code}
          <span className="ml-2 text-xs font-normal text-slate-400">
            {detail?.status}（v{detail?.version}）
          </span>
        </h1>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-amber-600">有未保存的更改</span>}
          <Link
            href={`/sales/quotations/${id}`}
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

        {/* ── 头字段（只读展示 customer/currency/status；仅编辑业务输入） ── */}
        <div className="mb-4 grid grid-cols-2 gap-4 rounded-md bg-slate-50 p-4 text-sm md:grid-cols-3">
          <div>
            <label className="block text-xs text-slate-500">客户（只读）</label>
            <p className="mt-1 text-slate-700">
              {detail?.customer ? `${detail.customer.code ?? ""} ${detail.customer.name ?? ""}`.trim() : "—"}
            </p>
          </div>
          <div>
            <label className="block text-xs text-slate-500">币种（只读）</label>
            <p className="mt-1 text-slate-700">{detail?.currency ?? "—"}</p>
          </div>
          <div>
            <label className="block text-xs text-slate-500">含税合计（只读）</label>
            <p className="mt-1 text-slate-700">
              {formatMoney(detail?.totalAmount ?? "0", detail?.currency ?? "CNY")}
            </p>
          </div>
          <div>
            <label className="block text-xs text-slate-500">有效期从（可选）</label>
            <input
              type="datetime-local"
              value={validFrom}
              onChange={(e) => {
                setValidFrom(e.target.value);
                markDirty();
              }}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500">有效期至（可选）</label>
            <input
              type="datetime-local"
              value={validUntil}
              onChange={(e) => {
                setValidUntil(e.target.value);
                markDirty();
              }}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500">税率档案（可选）</label>
            <select
              value={taxProfileId}
              onChange={(e) => {
                setTaxProfileId(e.target.value);
                markDirty();
              }}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none"
            >
              <option value="">未指定</option>
              {taxProfiles.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code ?? ""} {t.name ?? ""}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2 md:col-span-3">
            <label className="block text-xs text-slate-500">备注（可选，≤1000）</label>
            <textarea
              value={remark}
              onChange={(e) => {
                setRemark(e.target.value);
                markDirty();
              }}
              rows={2}
              maxLength={1000}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none"
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
          <h2 className="text-sm font-medium text-slate-700">
            报价明细（{lines.length}）——单价/金额为后端定价快照，只读
          </h2>
        </div>
        {fieldErrors.lines && <p className="mb-2 text-xs text-red-600">{fieldErrors.lines}</p>}

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
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
              {lines.map((line, idx) => (
                <tr key={line.id}>
                  <td className="px-3 py-2 text-slate-600">{line.lineNo}</td>
                  <td className="px-3 py-2 text-slate-700">
                    {line.item ? `${line.item.code ?? ""} ${line.item.name ?? ""}`.trim() : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={line.description}
                      onChange={(e) => updateLineField(idx, { description: e.target.value })}
                      placeholder="可选"
                      maxLength={500}
                      className="focus:border-brand-500 w-full min-w-40 rounded-md border border-slate-200 px-2 py-1.5 focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={line.quantity}
                      onChange={(e) => updateLineField(idx, { quantity: e.target.value })}
                      className="focus:border-brand-500 w-24 rounded-md border border-slate-200 px-2 py-1.5 focus:outline-none"
                    />
                    {fieldErrors[`line.${line.id}`] && (
                      <p className="mt-0.5 text-xs text-red-600">{fieldErrors[`line.${line.id}`]}</p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {formatMoney(line.unitPrice, detail?.currency ?? "CNY")}
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {formatMoney(line.totalAmount, detail?.currency ?? "CNY")}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => saveLine(line)}
                        disabled={submitting}
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteLine(line)}
                        disabled={submitting}
                        className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-400">
                    暂无明细行
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── 新增行（POST /lines；不发送 unitPrice） ── */}
        <div className="mt-4 rounded-md border border-dashed border-slate-300 p-3">
          <p className="mb-2 text-xs font-medium text-slate-500">新增行</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <select
                value={newItemId}
                onChange={(e) => setNewItemId(e.target.value)}
                className="focus:border-brand-500 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:outline-none"
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
                className="focus:border-brand-500 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:outline-none"
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
                className="focus:border-brand-500 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:outline-none"
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
          {fieldErrors.newLine && <p className="mt-1 text-xs text-red-600">{fieldErrors.newLine}</p>}
        </div>

        {dirty && <span className="mt-3 block text-xs text-amber-600">有未保存的更改</span>}
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
