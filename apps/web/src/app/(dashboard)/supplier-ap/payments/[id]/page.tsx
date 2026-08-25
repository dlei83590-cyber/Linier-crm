"use client";

/** Supplier Payments — 付款单详情页（5C-2；展示未结算项 + 核销录入 + apply/void 按钮） */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { AppPage, EntityFormWorkspace, StatusBadge, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { SELECT_CLASS } from "@/lib/ui-classes";
import { formatDate, formatMoney } from "@/lib/format";

interface OpenItemRow {
  id: string;
  currency: string;
  openAmount: string;
  settlementStatus: string;
  dueDate: string | null;
  apLiabilityFact?: { supplierInvoice?: { invoiceNo: string } | null } | null;
}

interface PaymentDetail {
  id: string;
  code: string;
  currency: string;
  amount: string;
  allocatedAmount: string;
  unallocatedAmount: string;
  paymentDate: string;
  paymentMethod: string;
  referenceNo: string | null;
  status: string;
  voidedAt: string | null;
  // 整体冲销（Red Reversal，5C-2）：reversedAt 非空即已冲销（纠错动作，保留逆向留痕）
  version: number;
  reversedAt: string | null;
  reversedById?: string | null;
  reverseReason?: string | null;
  supplier?: { id: string; code: string; name: string } | null;
  allocations?: Array<{ id: string; allocatedAmount: string; allocatedAt: string; apOpenItem?: { id: string; openAmount: string } | null }>;
}

const STATUS_LABELS: Record<string, string> = { UNALLOCATED: "未核销", PARTIALLY_ALLOCATED: "部分核销", ALLOCATED: "已全额核销" };
const STATUS_TONE_MAP: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { UNALLOCATED: "neutral", PARTIALLY_ALLOCATED: "info", ALLOCATED: "success" };
const METHOD_LABELS: Record<string, string> = { BANK_TRANSFER: "银行转账", CHEQUE: "支票", CASH: "现金", CARD: "刷卡", OTHER: "其他", BANK_ACCEPTANCE_BILL: "银行承兑汇票", COMMERCIAL_ACCEPTANCE_BILL: "商业承兑汇票", TT_ELECTRONIC_TRANSFER: "电汇" };

function PaymentDetailView() {
  const { state } = useSession();
  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canEdit = hasPermission(roles, actionPermission("supplier-payment", "edit"));
  const canClose = hasPermission(roles, actionPermission("supplier-payment", "close"));
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [detail, setDetail] = useState<PaymentDetail | null>(null);
  const [openItems, setOpenItems] = useState<OpenItemRow[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [allocAmount, setAllocAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<ApiClientError | null>(null);
  // 整体冲销（Red Reversal）对话框
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState("");
  const [reverseError, setReverseError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      apiFetch<PaymentDetail>(`/api/supplier-payments/${id}`),
    ])
      .then(([p]) => {
        setDetail(p.data);
        setLoading(false);
        // 拉取该供应商未结算项（核销目标）
        if (p.data.supplier?.id) {
          apiFetch<OpenItemRow[]>(`/api/ap-open-items?pageSize=100&supplierId=${p.data.supplier.id}&settlementStatus=UNPAID`)
            .then((body) => setOpenItems(body.data))
            .catch(() => setOpenItems([]));
        }
      })
      .catch((err: unknown) => { setLoadError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR")); setLoading(false); });
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const runApply = () => {
    if (!detail || acting) return;
    if (!selectedItemId || !allocAmount || Number(allocAmount) <= 0) { setActionError(new ApiClientError(400, "请选择未结项并输入核销金额", "VALIDATION")); return; }
    setActing(true);
    setActionError(null);
    apiFetch<{ id: string }>(`/api/supplier-payments/${id}/apply`, {
      method: "POST",
      body: JSON.stringify({ apOpenItemId: selectedItemId, allocatedAmount: Number(allocAmount) }),
    })
      .then(() => { setSelectedItemId(""); setAllocAmount(""); load(); setActing(false); })
      .catch((err: unknown) => { setActionError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR")); setActing(false); });
  };

  const runVoid = () => {
    if (!detail || acting) return;
    setActing(true);
    setActionError(null);
    apiFetch<{ id: string }>(`/api/supplier-payments/${id}/void`, { method: "POST", body: "{}" })
      .then(() => load())
      .catch((err: unknown) => { setActionError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR")); setActing(false); });
  };

  // 整体冲销（Red Reversal，5C-2）：反转全部未反转核销 + 回滚 openAmount 投影 + 标记 reversed（同事务）
  const runReverse = () => {
    if (!detail || acting) return;
    if (!reverseReason.trim()) { setReverseError("请填写冲销原因"); return; }
    setActing(true);
    setActionError(null);
    setReverseError(null);
    apiFetch<{ id: string; reversed: boolean; reversedAllocations: number }>(`/api/supplier-payments/${id}/reverse`, {
      method: "POST",
      body: JSON.stringify({ reason: reverseReason.trim(), version: detail.version }),
    })
      .then(() => { setReverseOpen(false); setReverseReason(""); load(); setActing(false); })
      .catch((err: unknown) => {
        const e = err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR");
        setReverseError(`${e.status} ${e.message}${e.code ? `（${e.code}）` : ""}`);
        setActing(false);
      });
  };

  if (loading) return (<AppPage><p className="px-4 py-6 text-sm text-ink-secondary">加载中…</p></AppPage>);
  if (loadError || !detail) return (<AppPage><ErrorPanel error={loadError ?? new ApiClientError(500, "加载失败", "LOAD_ERROR")} onRetry={load} /></AppPage>);

  const canApply = canEdit && !detail.voidedAt && !detail.reversedAt && detail.status !== "ALLOCATED";
  const canVoid = canClose && !detail.voidedAt && !detail.reversedAt && detail.status === "UNALLOCATED";
  // 整体冲销：仅已核销（存在未反转 allocations）且未作废/未冲销的付款单（后端 NO_ALLOCATIONS/VERSION_CONFLICT/MAKER_CHECKER 兜底）
  const canReverse = canEdit && !detail.voidedAt && !detail.reversedAt && (detail.allocations?.length ?? 0) > 0;

  return (
    <AppPage>
      <EntityFormWorkspace
        title="付款单"
        description={`付款单号：${detail.code} ｜ 状态：${STATUS_LABELS[detail.status] ?? detail.status}${detail.voidedAt ? "（已作废）" : ""}${detail.reversedAt ? "（已整体冲销）" : ""}`}
        backHref="/supplier-ap/payments"
        mode="edit"
        submitting={acting}
        error={actionError}
        dirty={false}
        saveLabel={canApply ? "核销所选未结项" : undefined}
        onSave={runApply}
        onCancel={() => router.push("/supplier-ap/payments")}
      >
        <section className="rounded-md border border-border p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div><span className="text-sm text-ink-secondary">供应商</span><div className="text-sm font-medium">{detail.supplier?.name ?? "—"}</div></div>
            <div><span className="text-sm text-ink-secondary">付款金额</span><div className="text-sm font-medium">{formatMoney(detail.amount, detail.currency)}</div></div>
            <div><span className="text-sm text-ink-secondary">未核销余额</span><div className="text-sm font-medium">{formatMoney(detail.unallocatedAmount, detail.currency)}</div></div>
            <div><span className="text-sm text-ink-secondary">付款日期</span><div className="text-sm font-medium">{formatDate(detail.paymentDate)}</div></div>
            <div><span className="text-sm text-ink-secondary">付款方式</span><div className="text-sm font-medium">{METHOD_LABELS[detail.paymentMethod] ?? detail.paymentMethod}</div></div>
            <div><span className="text-sm text-ink-secondary">状态</span><div><StatusBadge status={detail.status} label={STATUS_LABELS[detail.status] ?? detail.status} toneMap={STATUS_TONE_MAP} /></div></div>
            <div className="md:col-span-3"><span className="text-sm text-ink-secondary">银行流水号</span><div className="text-sm font-medium">{detail.referenceNo ?? "—"}</div></div>
          </div>
        </section>
        {canApply && (
          <section className="rounded-md border border-border p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink-primary">核销应付未结项（同供应商同币种；防超核销锁内重算）</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1"><span className="text-sm font-medium text-ink-secondary">未结算项</span>
                <select value={selectedItemId} onChange={(e) => setSelectedItemId(e.target.value)} className={SELECT_CLASS}>
                  <option value="">请选择</option>
                  {openItems.map((oi) => (<option key={oi.id} value={oi.id}>{oi.apLiabilityFact?.supplierInvoice?.invoiceNo ?? "未结项"}（余额 {formatMoney(oi.openAmount, oi.currency)}）</option>))}
                </select>
              </label>
              <label className="flex flex-col gap-1"><span className="text-sm font-medium text-ink-secondary">核销金额</span>
                <input type="number" min={0.01} step="any" value={allocAmount} onChange={(e) => setAllocAmount(e.target.value)} className={SELECT_CLASS} />
              </label>
            </div>
            <div className="mt-3 flex items-center gap-2">
              {canVoid && (<button type="button" onClick={runVoid} disabled={acting} className="rounded-md border border-status-danger-border px-3 py-1.5 text-sm font-medium text-status-danger-text hover:bg-status-danger-bg disabled:opacity-50">作废付款单（仅未核销）</button>)}
              {canReverse && (<button type="button" onClick={() => { setReverseOpen(true); setReverseReason(""); setReverseError(null); }} disabled={acting} className="rounded-md border border-status-danger-border px-3 py-1.5 text-sm font-medium text-status-danger-text hover:bg-status-danger-bg disabled:opacity-50">整体冲销（红字）</button>)}
            </div>
          </section>
        )}
        <section className="rounded-md border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink-primary">已核销记录（{detail.allocations?.length ?? 0}）</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="text-left text-xs font-medium text-ink-secondary"><tr><th className="px-3 py-2">核销金额</th><th className="px-3 py-2">核销时间</th></tr></thead>
              <tbody className="divide-y divide-border">
                {(detail.allocations ?? []).map((a) => (<tr key={a.id}><td className="px-3 py-2">{formatMoney(a.allocatedAmount, detail.currency)}</td><td className="px-3 py-2">{formatDate(a.allocatedAt)}</td></tr>))}
              </tbody>
            </table>
          </div>
        </section>
      </EntityFormWorkspace>

      {/* ── 整体冲销（Red Reversal）确认对话框 ── */}
      {reverseOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setReverseOpen(false)}
        >
          <div
            className="border-border bg-surface shadow-elevation-lg w-full max-w-md rounded-lg border p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-ink-primary text-base font-semibold">整体冲销付款单</h2>
            <p className="text-ink-secondary mt-2 text-sm">
              将反转全部未反转核销并回滚应付未结项余额（同事务红字冲销，保留逆向留痕）；冲销人不能是付款单创建人（maker-checker）。
            </p>
            {reverseError && (
              <div className="border-status-danger-border mt-3 rounded-md border bg-status-danger-bg p-2 text-sm text-status-danger-text">
                {reverseError}
              </div>
            )}
            <label className="mt-4 block text-xs text-ink-secondary">冲销原因 *</label>
            <input
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
              maxLength={500}
              placeholder="请填写冲销原因"
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReverseOpen(false)}
                disabled={acting}
                className="border-border text-ink-secondary rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={runReverse}
                disabled={acting}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {acting ? "冲销中…" : "确认整体冲销"}
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
    <PermissionGuard permission={actionPermission("supplier-payment", "view")}>
      <PaymentDetailView />
    </PermissionGuard>
  );
}