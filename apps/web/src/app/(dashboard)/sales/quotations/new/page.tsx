"use client";

/**
 * Quotation Create — 新建报价单（F2-6B Sales Source-driven Actions，批 1）
 *
 * Direct Create 允许（contract：POST /api/quotations，quotation:create）。
 * Header：customerId（必填）/ currency（默认 CNY）/ validFrom? / validUntil? / remark?
 * Lines：itemId / description? / quantity / uomId?（选物料自动带出 stockUom）
 * 成功 → 服务端返回 id/code → 跳转权威 Detail（re-GET）。
 * 商机→报价 MVP：?opportunityId=… 进入时自动带入并锁定客户（ProjectOpportunity.customer），
 * opportunityId 随单保存（POST /api/quotations 已支持）；?customerId=… 亦可直接预填客户。
 * PermissionGuard 对齐 API requirePermission("quotation:create")。
 */
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, CARD_CLASS, INPUT_CLASS } from "@/lib/ui-classes";

interface ItemOption {
  id: string;
  code: string | null;
  name: string | null;
  stockUom?: { id: string; code: string | null; symbol: string | null } | null;
}

interface CustomerOption {
  id: string;
  code: string | null;
  name: string | null;
}

interface CommercialTermOption {
  id: string;
  code: string | null;
  name: string | null;
}

interface LineForm {
  itemId: string;
  description: string;
  quantity: string;
  uomId: string;
}

const EMPTY_LINE: LineForm = { itemId: "", description: "", quantity: "", uomId: "" };

/** 币种受控选择（Phase 2：币种来自系统受控列表，禁止自由文本输入） */
const CURRENCY_OPTIONS = ["CNY", "USD", "EUR", "HKD", "GBP", "JPY"] as const;

function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function QuotationCreateForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 商机→报价 MVP：从商机详情「创建报价」进入（opportunityId）或携带 customerId 预填客户
  const opportunityIdParam = searchParams.get("opportunityId") ?? "";
  const customerIdParam = searchParams.get("customerId") ?? "";
  const [items, setItems] = useState<ItemOption[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [terms, setTerms] = useState<CommercialTermOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [opportunityId] = useState(opportunityIdParam);
  const [opportunityLabel, setOpportunityLabel] = useState("");
  const [presetCustomer, setPresetCustomer] = useState<CustomerOption | null>(null);
  const [presetLoading, setPresetLoading] = useState(Boolean(opportunityIdParam));
  const [currency, setCurrency] = useState("CNY");
  // 有效期默认：从 = 当前系统日期；至 = 当前 + 30 天（date 输入，精确到天，无分钟）
  const today = new Date();
  const fmtDate = (d: Date) =>
    d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const [validFrom, setValidFrom] = useState(fmtDate(today));
  const [validUntil, setValidUntil] = useState(fmtDate(new Date(today.getTime() + 30 * 86400000)));
  const [paymentTerm, setPaymentTerm] = useState("");
  const [remark, setRemark] = useState("");
  const [lines, setLines] = useState<LineForm[]>([{ ...EMPTY_LINE }]);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Q 线：CSV 批量导入（itemCode,quantity,unitPrice?；unitPrice 仅供预览，行价由系统定价引擎决定——ADR-0015 红线）
  const [csvInput, setCsvInput] = useState("");
  const [csvError, setCsvError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiFetch<ItemOption[]>("/api/items?pageSize=100", { signal: controller.signal }),
      apiFetch<CustomerOption[]>("/api/business-partners?pageSize=100&type=CUSTOMER&isActive=true", { signal: controller.signal }),
      apiFetch<CommercialTermOption[]>("/api/commercial-terms?pageSize=100&isActive=true", { signal: controller.signal }),
    ])
      .then(([itemsBody, customersBody, termsBody]) => {
        setItems(itemsBody.data);
        setCustomers(customersBody.data);
        setTerms(termsBody.data);
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

  // 商机→报价 MVP：opportunityId 参数 → 读取商机（编号/名称/客户），自动带入客户并锁定
  useEffect(() => {
    if (!opportunityIdParam) {
      if (customerIdParam) setCustomerId(customerIdParam);
      return;
    }
    const controller = new AbortController();
    apiFetch<{ id: string; code: string; name: string; customer: CustomerOption | null }>(
      "/api/project-opportunities/" + opportunityIdParam,
      { signal: controller.signal },
    )
      .then((body) => {
        const opp = body.data;
        setOpportunityLabel(((opp.code ?? "") + " " + (opp.name ?? "")).trim());
        if (opp.customer?.id) {
          setPresetCustomer({ id: opp.customer.id, code: opp.customer.code, name: opp.customer.name });
          setCustomerId(opp.customer.id);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // 商机读取失败：退回手动选择客户，不阻断报价创建（仅提示）
        setError(
          err instanceof ApiClientError ? err : new ApiClientError(0, "加载商机信息失败", "NETWORK_ERROR"),
        );
      })
      .finally(() => setPresetLoading(false));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunityIdParam, customerIdParam]);

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
    if (patch.itemId) {
      const item = items.find((it) => it.id === patch.itemId);
      if (item?.stockUom?.id) {
        setLines((prev) =>
          prev.map((l, i) => (i === idx ? { ...l, uomId: item.stockUom?.id ?? l.uomId } : l)),
        );
      }
    }
  };

  const addLine = () => {
    setLines((prev) => [...prev, { ...EMPTY_LINE }]);
    markDirty();
  };

  const importCsv = () => {
    setCsvError("");
    const rows = csvInput
      .split(/\r?\n/)
      .map((ln) => ln.trim())
      .filter(Boolean);
    if (rows.length === 0) {
      setCsvError("请粘贴 CSV（每行：itemCode,quantity[,unitPrice]）");
      return;
    }
    const errors: string[] = [];
    const added: LineForm[] = [];
    for (let i = 0; i < rows.length; i++) {
      const cols = rows[i].split(",").map((c) => c.trim());
      const [itemCode, quantity, unitPrice] = cols;
      if (!itemCode) {
        errors.push("第 " + (i + 1) + " 行：缺少 itemCode");
        continue;
      }
      const item = items.find((it) => it.code === itemCode);
      if (!item) {
        errors.push("第 " + (i + 1) + " 行：未找到编码 " + itemCode);
        continue;
      }
      const qty = Number(quantity);
      if (!quantity || !(qty > 0)) {
        errors.push("第 " + (i + 1) + " 行：数量必须大于 0");
        continue;
      }
      if (unitPrice !== undefined && unitPrice !== "" && Number.isNaN(Number(unitPrice))) {
        errors.push("第 " + (i + 1) + " 行：unitPrice 非数字（行价最终由系统定价引擎决定）");
        continue;
      }
      added.push({ itemId: item.id, description: item.code ?? "", quantity, uomId: item.stockUom?.id ?? "" });
    }
    if (errors.length > 0) {
      setCsvError(errors.slice(0, 10).join("；") + (errors.length > 10 ? "（其余略）" : ""));
      return;
    }
    if (added.length === 0) return;
    setLines(added.length === 1 ? added : added);
    markDirty();
    setCsvInput("");
  };

  const removeLine = (idx: number) => {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
    markDirty();
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!customerId) errs.customerId = "请选择客户";
    if (validFrom && validUntil && toIso(validUntil) && toIso(validFrom) && new Date(validUntil) < new Date(validFrom)) {
      errs.validUntil = "有效期至不能早于有效期从";
    }
    lines.forEach((l, i) => {
      if (!l.itemId) errs[`lines.${i}.itemId`] = "请选择物料";
      if (!l.quantity || Number(l.quantity) <= 0) errs[`lines.${i}.quantity`] = "数量必须大于 0";
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
      const payload = {
        customerId,
        ...(opportunityId ? { opportunityId } : {}),
        currency,
        ...(validFrom ? { validFrom: toIso(validFrom) } : {}),
        ...(validUntil ? { validUntil: toIso(validUntil) } : {}),
        ...(paymentTerm ? { paymentTerm } : {}),
        ...(remark ? { remark } : {}),
        lines: lines.map((l) => ({
          itemId: l.itemId,
          ...(l.description ? { description: l.description } : {}),
          quantity: Number(l.quantity),
          ...(l.uomId ? { uomId: l.uomId } : {}),
        })),
      };
      const body = await apiFetch<{ id: string; code: string }>("/api/quotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setDirty(false);
      router.push(`/sales/quotations/${body.data.id}`);
    } catch (err: unknown) {
      setError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "创建失败", "NETWORK_ERROR"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center justify-between border-b border-border p-4">
        <h1 className="text-lg font-semibold text-ink-primary">新建报价单</h1>
        <Link
          href="/sales/quotations"
          onClick={(e) => {
            if (dirty && !window.confirm("有未保存的更改，确定离开？")) e.preventDefault();
          }}
          className={BUTTON_SECONDARY_CLASS}
        >
          返回列表
        </Link>
      </div>

      <div className="p-4">
        {error && (
          <div className="mb-4">
            <ErrorPanel error={error} />
          </div>
        )}
        {opportunityId && (
          <div className="mb-4 rounded-md border border-border bg-canvas p-3 text-sm text-ink-secondary">
            {presetLoading
              ? "正在加载商机信息…"
              : opportunityLabel
                ? "来自商机：" +
                  opportunityLabel +
                  (presetCustomer
                    ? " · 客户已带入（" + (presetCustomer.code ?? "") + " " + (presetCustomer.name ?? "") + "）"
                    : "")
                : "商机信息加载失败，请手动选择客户"}
          </div>
        )}

        <div className="mb-4 grid grid-cols-1 gap-4 rounded-md bg-canvas p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="block text-xs text-ink-secondary">
              {presetCustomer ? "客户（来自商机）*" : "客户 *"}
            </label>
            <select
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                markDirty();
              }}
              disabled={presetCustomer !== null}
              className={"mt-1 " + INPUT_CLASS}
            >
              <option value="">选择客户</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code ?? ""} {c.name ?? ""}
                </option>
              ))}
            </select>
            {fieldErrors.customerId && (
              <p className="mt-0.5 text-xs text-status-danger-text">{fieldErrors.customerId}</p>
            )}
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">币种</label>
            <select
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value);
                markDirty();
              }}
              className={"mt-1 " + INPUT_CLASS}
            >
              {CURRENCY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">有效期从（默认今日）</label>
            <input
              type="date"
              value={validFrom}
              onChange={(e) => {
                setValidFrom(e.target.value);
                markDirty();
              }}
              className={"mt-1 " + INPUT_CLASS}
            />
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">有效期至（默认 +30 天）</label>
            <input
              type="date"
              value={validUntil}
              onChange={(e) => {
                setValidUntil(e.target.value);
                markDirty();
              }}
              className={"mt-1 " + INPUT_CLASS}
            />
            {fieldErrors.validUntil && (
              <p className="mt-0.5 text-xs text-status-danger-text">{fieldErrors.validUntil}</p>
            )}
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">付款方式（商业条款）</label>
            <select
              value={paymentTerm}
              onChange={(e) => {
                setPaymentTerm(e.target.value);
                markDirty();
              }}
              className={"mt-1 " + INPUT_CLASS}
            >
              <option value="">请选择付款方式</option>
              {terms.map((t) => (
                <option key={t.id} value={t.code ?? t.name ?? t.id}>
                  {t.name ?? t.code}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2 lg:col-span-1">
            <label className="block text-xs text-ink-secondary">备注（可选，≤1000）</label>
            <textarea
              value={remark}
              onChange={(e) => {
                setRemark(e.target.value);
                markDirty();
              }}
              rows={2}
              maxLength={1000}
              className={"mt-1 " + INPUT_CLASS}
            />
          </div>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink-secondary">报价明细（至少一行）</h2>
          <button
            type="button"
            onClick={addLine}
            className={BUTTON_SECONDARY_CLASS}
          >
            + 添加行
          </button>
        </div>
        {/* Q 线：CSV 批量导入（itemCode,quantity[,unitPrice]；unitPrice 仅供预览，行价由系统定价引擎决定） */}
        <div className="mb-3 rounded-md border border-border p-3">
          <p className="mb-1 text-xs text-ink-muted">
            CSV 批量导入：每行 <code>itemCode,quantity[,unitPrice]</code>，例如 <code>LG-SG45,100,45.5</code>
          </p>
          <textarea
            value={csvInput}
            onChange={(e) => setCsvInput(e.target.value)}
            rows={3}
            placeholder={"LG-SG45,100\nM8X25,200"}
            className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 font-mono text-xs focus:outline-none"
          />
          {csvError && <p className="mt-1 text-xs text-status-danger-text">{csvError}</p>}
          <button
            type="button"
            onClick={importCsv}
            className={BUTTON_SECONDARY_CLASS}
          >
            导入 CSV
          </button>
        </div>
        {fieldErrors.lines && <p className="mb-2 text-xs text-status-danger-text">{fieldErrors.lines}</p>}

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
              <tr>
                <th className="px-3 py-2">物料</th>
                <th className="px-3 py-2">描述</th>
                <th className="px-3 py-2">数量</th>
                <th className="px-3 py-2">单位</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((line, idx) => (
                <tr key={idx}>
                  <td className="px-3 py-2">
                    <select
                      value={line.itemId}
                      onChange={(e) => updateLine(idx, { itemId: e.target.value })}
                      className="focus:border-brand-500 w-full rounded-md border border-border px-2 py-1.5 focus:outline-none"
                    >
                      <option value="">选择物料</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.code ?? ""} {it.name ?? ""}
                        </option>
                      ))}
                    </select>
                    {fieldErrors[`lines.${idx}.itemId`] && (
                      <p className="mt-0.5 text-xs text-status-danger-text">
                        {fieldErrors[`lines.${idx}.itemId`]}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={line.description}
                      onChange={(e) => updateLine(idx, { description: e.target.value })}
                      placeholder="可选"
                      maxLength={500}
                      className="focus:border-brand-500 w-full rounded-md border border-border px-2 py-1.5 focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={line.quantity}
                      onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                      className="focus:border-brand-500 w-24 rounded-md border border-border px-2 py-1.5 focus:outline-none"
                    />
                    {fieldErrors[`lines.${idx}.quantity`] && (
                      <p className="mt-0.5 text-xs text-status-danger-text">
                        {fieldErrors[`lines.${idx}.quantity`]}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink-secondary">
                    {line.uomId
                      ? (items.find((it) => it.id === line.itemId)?.stockUom?.symbol ?? "—")
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => removeLine(idx)}
                      disabled={lines.length <= 1}
                      className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className={BUTTON_PRIMARY_CLASS}
          >
            {submitting ? "提交中…" : "创建（草稿）"}
          </button>
          {dirty && <span className="text-xs text-status-warning-text">有未保存的更改</span>}
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("quotation", "create")}>
      <Suspense fallback={null}>
        <QuotationCreateForm />
      </Suspense>
    </PermissionGuard>
  );
}