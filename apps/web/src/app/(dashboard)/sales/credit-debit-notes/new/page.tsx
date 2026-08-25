"use client";

/**
 * Credit/Debit Note Create — 新建贷项/借项通知单（F2-6B 批 2）
 *
 * Direct Create 允许（contract：POST /api/credit-debit-notes，credit-debit-note:create）。
 * 单票制：noteType + sourceInvoiceId（仅 ISSUED）+ reason + lines（sourceInvoiceLineId + quantity）。
 * Customer/Currency 从源 Invoice 继承（禁止客户端传）；金额快照由后端复制原 InvoiceLine（不重算）。
 * 成功 → 服务端返回 creditDebitNote.id → 跳转列表（无详情 GET 端点，列表内联明细/动作）。
 * PermissionGuard 对齐 API requirePermission("credit-debit-note:create")。
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, CARD_CLASS, INPUT_CLASS } from "@/lib/ui-classes";
import { formatMoney } from "@/lib/format";

interface InvoiceOption {
  id: string;
  code: string | null;
  status: string;
  invoiceTotal: string;
  customer?: { id: string; code: string | null; name: string | null } | null;
}

interface InvoiceLine {
  id: string;
  lineNo: number;
  description?: string | null;
  quantity: string;
  totalAmount: string;
  item?: { id: string; code: string | null; name: string | null } | null;
}

interface LineForm {
  sourceInvoiceLineId: string;
  quantity: string;
}

const NOTE_TYPE_LABEL: Record<string, string> = {
  CREDIT: "贷项（冲减应收）",
  DEBIT: "借项（正向调整）",
};

function CnDnCreateForm() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [noteType, setNoteType] = useState<string>("CREDIT");
  const [sourceInvoiceId, setSourceInvoiceId] = useState("");
  const [reason, setReason] = useState("");
  const [invoiceLines, setInvoiceLines] = useState<InvoiceLine[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [lines, setLines] = useState<LineForm[]>([]);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<InvoiceOption[]>("/api/invoices?status=ISSUED&pageSize=100", { signal: controller.signal })
      .then((body) => setInvoices(body.data))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof ApiClientError
            ? err
            : new ApiClientError(0, "加载已开具发票失败", "NETWORK_ERROR"),
        );
      });
    return () => controller.abort();
  }, []);

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

  // 选择源发票后拉取明细行（快照展示 + 调整数量录入）
  const handleInvoiceChange = async (invoiceId: string) => {
    setSourceInvoiceId(invoiceId);
    markDirty();
    setInvoiceLines([]);
    setLines([]);
    if (!invoiceId) return;
    setLoadingLines(true);
    try {
      const body = await apiFetch<{ lines?: InvoiceLine[] }>(`/api/invoices/${invoiceId}`);
      const ls = body.data.lines ?? [];
      setInvoiceLines(ls);
      setLines(ls.map((l) => ({ sourceInvoiceLineId: l.id, quantity: "" })));
    } catch (err: unknown) {
      setError(
        err instanceof ApiClientError
          ? err
          : new ApiClientError(0, "加载发票明细失败", "NETWORK_ERROR"),
      );
    } finally {
      setLoadingLines(false);
    }
  };

  const updateLineQty = (idx: number, quantity: string) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, quantity } : l)));
    markDirty();
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!noteType) errs.noteType = "请选择通知单类型";
    if (!sourceInvoiceId) errs.sourceInvoiceId = "请选择源发票";
    if (!reason.trim()) errs.reason = "请填写调整原因";
    const withQty = lines.filter((l) => l.quantity && Number(l.quantity) > 0);
    if (withQty.length === 0) errs.lines = "至少需要一行有效调整数量";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        noteType,
        sourceInvoiceId,
        reason: reason.trim(),
        lines: lines
          .filter((l) => l.quantity && Number(l.quantity) > 0)
          .map((l) => ({ sourceInvoiceLineId: l.sourceInvoiceLineId, quantity: Number(l.quantity) })),
      };
      await apiFetch("/api/credit-debit-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setDirty(false);
      router.push("/sales/credit-debit-notes");
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
        <h1 className="text-lg font-semibold text-ink-primary">新建贷项/借项通知单</h1>
        <Link
          href="/sales/credit-debit-notes"
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

        <div className="mb-4 grid grid-cols-1 gap-4 rounded-md bg-canvas p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="block text-xs text-ink-secondary">通知单类型 *</label>
            <select
              value={noteType}
              onChange={(e) => {
                setNoteType(e.target.value);
                markDirty();
              }}
              className={"mt-1 " + INPUT_CLASS}
            >
              <option value="CREDIT">{NOTE_TYPE_LABEL.CREDIT}</option>
              <option value="DEBIT">{NOTE_TYPE_LABEL.DEBIT}</option>
            </select>
            {fieldErrors.noteType && (
              <p className="mt-0.5 text-xs text-status-danger-text">{fieldErrors.noteType}</p>
            )}
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">源发票（仅 ISSUED）*</label>
            <select
              value={sourceInvoiceId}
              onChange={(e) => handleInvoiceChange(e.target.value)}
              className={"mt-1 " + INPUT_CLASS}
            >
              <option value="">选择发票</option>
              {invoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.code ?? "（未编号）"}（{inv.customer?.name ?? "—"} · {formatMoney(inv.invoiceTotal, "CNY")}）
                </option>
              ))}
            </select>
            {fieldErrors.sourceInvoiceId && (
              <p className="mt-0.5 text-xs text-status-danger-text">{fieldErrors.sourceInvoiceId}</p>
            )}
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">调整原因 *（≤500）</label>
            <input
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                markDirty();
              }}
              maxLength={500}
              className={"mt-1 " + INPUT_CLASS}
            />
            {fieldErrors.reason && (
              <p className="mt-0.5 text-xs text-status-danger-text">{fieldErrors.reason}</p>
            )}
          </div>
        </div>

        <p className="mb-3 rounded-md bg-status-warning-bg p-3 text-xs text-status-warning-text">
          金额/税率/价格由后端复制原发票行快照（不重算）；客户与币种从源发票继承。贷项为负向冲减应收、借项为正向调整。
        </p>

        <h2 className="mb-2 text-sm font-medium text-ink-secondary">调整明细（填入调整数量，须大于 0）</h2>
        {fieldErrors.lines && <p className="mb-2 text-xs text-status-danger-text">{fieldErrors.lines}</p>}

        {loadingLines ? (
          <p className="text-ink-secondary py-6 text-center text-sm">加载发票明细…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
                <tr>
                  <th className="px-3 py-2">行号</th>
                  <th className="px-3 py-2">物料</th>
                  <th className="px-3 py-2">描述</th>
                  <th className="px-3 py-2">原数量</th>
                  <th className="px-3 py-2">行金额</th>
                  <th className="px-3 py-2">调整数量</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoiceLines.map((line, idx) => (
                  <tr key={line.id}>
                    <td className="px-3 py-2 text-ink-secondary">{line.lineNo}</td>
                    <td className="px-3 py-2 text-ink-secondary">
                      {line.item ? `${line.item.code ?? ""} ${line.item.name ?? ""}`.trim() : "—"}
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{line.description ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{line.quantity}</td>
                    <td className="px-3 py-2 text-ink-secondary">{formatMoney(line.totalAmount, "CNY")}</td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={lines[idx]?.quantity ?? ""}
                        onChange={(e) => updateLineQty(idx, e.target.value)}
                        className="focus:border-brand-500 w-28 rounded-md border border-border px-2 py-1.5 focus:outline-none"
                      />
                    </td>
                  </tr>
                ))}
                {invoiceLines.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-sm text-ink-muted">
                      {sourceInvoiceId ? "该发票无明细行" : "请先选择源发票"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

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
    <PermissionGuard permission={actionPermission("credit-debit-note", "create")}>
      <CnDnCreateForm />
    </PermissionGuard>
  );
}