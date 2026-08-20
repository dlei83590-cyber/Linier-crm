"use client";

/**
 * Receipt Create — 新建收款单（F2-6B 批 2）
 *
 * Direct Create 允许（contract：POST /api/receipts，receipt:create）。
 * 拍板①：创建与核销分离——这里只登记实际收到的钱（UNALLOCATED），核销走详情页 allocate。
 * Header：customerId（必填）/ currency（默认 CNY）/ amount（必填 >0）/ receiptDate? /
 *         paymentMethod（必填）/ referenceNo? / changeReason?
 * 成功 → 服务端返回 receipt.id → 跳转权威 Detail（re-GET）。
 * PermissionGuard 对齐 API requirePermission("receipt:create")。
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { CARD_CLASS } from "@/lib/ui-classes";

interface CustomerOption {
  id: string;
  code: string | null;
  name: string | null;
}

const PAYMENT_METHODS = ["BANK_TRANSFER", "CHEQUE", "CASH", "CARD", "OTHER"] as const;

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  BANK_TRANSFER: "银行转账",
  CHEQUE: "支票",
  CASH: "现金",
  CARD: "刷卡",
  BANK_ACCEPTANCE_BILL: "银行承兑汇票",
  COMMERCIAL_ACCEPTANCE_BILL: "商业承兑汇票",
  TT_ELECTRONIC_TRANSFER: "电汇",
  OTHER: "其他",
};

function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function ReceiptCreateForm() {
  const router = useRouter();
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [currency, setCurrency] = useState("CNY");
  const [amount, setAmount] = useState("");
  const [receiptDate, setReceiptDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("BANK_TRANSFER");
  const [referenceNo, setReferenceNo] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<CustomerOption[]>("/api/customers?pageSize=100", { signal: controller.signal })
      .then((body) => setCustomers(body.data))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof ApiClientError
            ? err
            : new ApiClientError(0, "加载客户列表失败", "NETWORK_ERROR"),
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

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!customerId) errs.customerId = "请选择客户";
    if (!amount || Number(amount) <= 0) errs.amount = "收款金额必须大于 0";
    if (!paymentMethod) errs.paymentMethod = "请选择收款方式";
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
        currency,
        amount: Number(amount),
        ...(receiptDate ? { receiptDate: toIso(receiptDate) } : {}),
        paymentMethod,
        ...(referenceNo ? { referenceNo } : {}),
        ...(changeReason ? { changeReason } : {}),
      };
      const body = await apiFetch<{ id: string; code: string }>("/api/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setDirty(false);
      router.push(`/sales/receipts/${body.data.id}`);
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
        <h1 className="text-lg font-semibold text-ink-primary">新建收款单</h1>
        <Link
          href="/sales/receipts"
          onClick={(e) => {
            if (dirty && !window.confirm("有未保存的更改，确定离开？")) e.preventDefault();
          }}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-canvas"
        >
          返回列表
        </Link>
      </div>

      <div className="p-4">
        {error && (
          <div className="mb-4 rounded-md bg-status-danger-bg p-3 text-sm text-status-danger-text">
            <p>
              {describeStatus(error.status)}：{error.message}
              {error.code ? `（${error.code}）` : ""}
            </p>
          </div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-4 rounded-md bg-canvas p-4 text-sm md:grid-cols-3">
          <div>
            <label className="block text-xs text-ink-secondary">客户 *</label>
            <select
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                markDirty();
              }}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
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
            <input
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value);
                markDirty();
              }}
              maxLength={10}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">收款金额 *</label>
            <input
              type="number"
              min="0"
              step="any"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                markDirty();
              }}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
            />
            {fieldErrors.amount && (
              <p className="mt-0.5 text-xs text-status-danger-text">{fieldErrors.amount}</p>
            )}
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">收款日期（可选）</label>
            <input
              type="datetime-local"
              value={receiptDate}
              onChange={(e) => {
                setReceiptDate(e.target.value);
                markDirty();
              }}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">收款方式 *</label>
            <select
              value={paymentMethod}
              onChange={(e) => {
                setPaymentMethod(e.target.value);
                markDirty();
              }}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}（{m}）
                </option>
              ))}
            </select>
            {fieldErrors.paymentMethod && (
              <p className="mt-0.5 text-xs text-status-danger-text">{fieldErrors.paymentMethod}</p>
            )}
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">参考号（可选，≤100）</label>
            <input
              value={referenceNo}
              onChange={(e) => {
                setReferenceNo(e.target.value);
                markDirty();
              }}
              maxLength={100}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-ink-secondary">变更说明（可选，≤500）</label>
            <input
              value={changeReason}
              onChange={(e) => {
                setChangeReason(e.target.value);
                markDirty();
              }}
              maxLength={500}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
            />
          </div>
        </div>

        <p className="mb-4 rounded-md bg-status-warning-bg p-3 text-xs text-status-warning-text">
          创建后收款单为「未核销」状态；核销请进入详情页按应收未结项逐笔核销。
        </p>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-brand-600 hover:bg-brand-700 rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "提交中…" : "创建收款单"}
          </button>
          {dirty && <span className="text-xs text-status-warning-text">有未保存的更改</span>}
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("receipt", "create")}>
      <ReceiptCreateForm />
    </PermissionGuard>
  );
}