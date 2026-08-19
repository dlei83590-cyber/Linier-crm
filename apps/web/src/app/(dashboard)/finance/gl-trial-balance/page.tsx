"use client";

/** GL 试算平衡 — 只读页（Sprint 7 Finance，ADR-0034；实时聚合，余额为派生投影） */
import { useEffect, useState } from "react";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";

interface TrialLine {
  accountId: string;
  code: string;
  name: string;
  category: string;
  direction: string;
  debit: string;
  credit: string;
  balance: string;
}
interface TrialData {
  lines: TrialLine[];
  totals: { debit: string; credit: string };
  inBalance: boolean;
}

const CATEGORY_LABELS: Record<string, string> = { ASSET: "资产", LIABILITY: "负债", EQUITY: "权益", REVENUE: "收入", EXPENSE: "费用" };

function TrialBalanceView() {
  const [data, setData] = useState<TrialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = (from = dateFrom, to = dateTo) => {
    setLoading(true);
    setError(null);
    const q = new URLSearchParams();
    if (from) q.set("dateFrom", from);
    if (to) q.set("dateTo", to);
    apiFetch<TrialData>(`/api/gl/trial-balance?${q.toString()}`)
      .then((body) => { setData(body.data); setLoading(false); })
      .catch((err: unknown) => { setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR")); setLoading(false); });
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <AppPage>
      <div className="flex items-center justify-between px-4 pt-4">
        <div>
          <h1 className="text-lg font-semibold text-ink-primary">试算平衡</h1>
          <p className="text-sm text-ink-secondary">按科目实时聚合借贷发生额与余额（派生投影，事实源 = 记账凭证）</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-md border border-border px-2 py-1.5 text-sm" />
          <span className="text-sm text-ink-secondary">至</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-md border border-border px-2 py-1.5 text-sm" />
          <button type="button" onClick={() => load()} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">查询</button>
        </div>
      </div>
      <div className="p-4">
        {loading ? <p className="text-sm text-ink-secondary">加载中…</p> : null}
        {error ? <ErrorPanel error={error} onRetry={() => load()} /> : null}
        {data && !loading && !error ? (
          <div className="space-y-3">
            <div className={`rounded-md border px-3 py-2 text-sm ${data.inBalance ? "border-status-success-border bg-status-success-bg text-status-success-text" : "border-status-danger-border bg-status-danger-bg text-status-danger-text"}`}>
              {data.inBalance ? "借贷平衡 ✓（Σ借方 = Σ贷方）" : "借贷不平衡 ✗（数据异常，请检查凭证）"}：借方 {formatMoney(data.totals.debit, "CNY")} ／ 贷方 {formatMoney(data.totals.credit, "CNY")}
            </div>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="text-left text-xs font-medium text-ink-secondary"><tr><th className="px-3 py-2">科目</th><th className="px-3 py-2">类别</th><th className="px-3 py-2 text-right">借方发生</th><th className="px-3 py-2 text-right">贷方发生</th><th className="px-3 py-2 text-right">余额</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {data.lines.map((l) => (
                    <tr key={l.accountId}>
                      <td className="px-3 py-2">{l.code} {l.name}</td>
                      <td className="px-3 py-2">{CATEGORY_LABELS[l.category] ?? l.category}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(l.debit, "CNY")}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(l.credit, "CNY")}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(l.balance, "CNY")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("gl", "view")}>
      <TrialBalanceView />
    </PermissionGuard>
  );
}
