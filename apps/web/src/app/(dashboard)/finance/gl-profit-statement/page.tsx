"use client";

/** GL 利润表（简化）— 只读页（Sprint 7 Finance，ADR-0034；期间收入−成本−费用） */
import { useEffect, useState } from "react";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS } from "@/lib/ui-classes";
import { formatMoney } from "@/lib/format";

interface ProfitLine { code: string; name: string; category: string; net: string; }
interface ProfitData { revenue: string; expense: string; profit: string; lines: ProfitLine[]; }

function ProfitStatementView() {
  const [data, setData] = useState<ProfitData | null>(null);
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
    apiFetch<ProfitData>(`/api/gl/profit-statement?${q.toString()}`)
      .then((body) => { setData(body.data); setLoading(false); })
      .catch((err: unknown) => { setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR")); setLoading(false); });
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <AppPage>
      <div className="flex items-center justify-between px-4 pt-4">
        <div>
          <h1 className="text-lg font-semibold text-ink-primary">利润表（简化）</h1>
          <p className="text-sm text-ink-secondary">期间收入 − 成本/费用 = 利润（实时聚合，事实源 = 记账凭证）</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-md border border-border px-2 py-1.5 text-sm" />
          <span className="text-sm text-ink-secondary">至</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-md border border-border px-2 py-1.5 text-sm" />
          <button type="button" onClick={() => load()} className={BUTTON_PRIMARY_CLASS}>查询</button>
        </div>
      </div>
      <div className="p-4">
        {loading ? <p className="text-sm text-ink-secondary">加载中…</p> : null}
        {error ? <ErrorPanel error={error} onRetry={() => load()} /> : null}
        {data && !loading && !error ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-md border border-border p-3"><div className="text-sm text-ink-secondary">收入</div><div className="text-lg font-semibold text-ink-primary">{formatMoney(data.revenue, "CNY")}</div></div>
              <div className="rounded-md border border-border p-3"><div className="text-sm text-ink-secondary">成本/费用</div><div className="text-lg font-semibold text-ink-primary">{formatMoney(data.expense, "CNY")}</div></div>
              <div className="rounded-md border border-border p-3"><div className="text-sm text-ink-secondary">利润</div><div className={`text-lg font-semibold ${Number(data.profit) >= 0 ? "text-status-success-text" : "text-status-danger-text"}`}>{formatMoney(data.profit, "CNY")}</div></div>
            </div>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="text-left text-xs font-medium text-ink-secondary"><tr><th className="px-3 py-2">科目</th><th className="px-3 py-2">类别</th><th className="px-3 py-2 text-right">期间净额</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {data.lines.map((l) => (
                    <tr key={l.code}>
                      <td className="px-3 py-2">{l.code} {l.name}</td>
                      <td className="px-3 py-2">{l.category === "REVENUE" ? "收入" : "费用"}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(l.net, "CNY")}</td>
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
      <ProfitStatementView />
    </PermissionGuard>
  );
}