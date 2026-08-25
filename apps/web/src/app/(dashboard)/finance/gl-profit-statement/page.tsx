"use client";

/** GL 利润表（简化）— 只读页（Sprint 7 Finance，ADR-0034；期间收入−成本−费用） */
// FRT-09：与试算平衡互链（本页暂无独立菜单入口，详见 PR body REGISTRY DELTA REQUIRED）
// FE2.0 UI-10：PageHeader 统一头部 + PageLoading 骨架屏 + KPI 卡片 + DetailTable（金额右对齐 tabular-nums / sticky header）
import { useEffect, useState } from "react";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, ErrorPanel, PageHeader, DetailTable } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { PageLoading } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/format";
import { AnimatedMoney } from "@/components/ui/animated-number";

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
      <PageHeader
        title="利润表（简化）"
        description="期间收入 − 成本/费用 = 利润（实时聚合，事实源 = 记账凭证）"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={SELECT_CLASS} />
            <span className="text-sm text-ink-secondary">至</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={SELECT_CLASS} />
            <button type="button" onClick={() => load()} className={BUTTON_PRIMARY_CLASS}>查询</button>
          </div>
        }
      />
      <div className="mt-4 space-y-3">
        <nav aria-label="GL 报表切换" className="flex items-center gap-1 text-sm">
          <Link href="/finance/gl-trial-balance" className="rounded-md border border-border px-2.5 py-1 text-ink-secondary hover:bg-slate-50">
            试算平衡
          </Link>
          <Link aria-current="page" href="/finance/gl-profit-statement" className="rounded-md bg-brand-600 px-2.5 py-1 font-medium text-white">
            利润表
          </Link>
        </nav>

        {loading ? (
          <div className="border-border bg-surface overflow-hidden rounded-lg border">
            <PageLoading rows={6} />
          </div>
        ) : null}
        {error ? <ErrorPanel error={error} onRetry={() => load()} /> : null}
        {data && !loading && !error ? (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="border-border bg-surface shadow-elevation-sm rounded-lg border p-4">
                <div className="text-ink-secondary text-sm">收入</div>
                <div className="text-ink-primary mt-1 text-xl font-semibold tabular-nums md:text-2xl">
                  <AnimatedMoney value={data.revenue} currency="CNY" />
                </div>
              </div>
              <div className="border-border bg-surface shadow-elevation-sm rounded-lg border p-4">
                <div className="text-ink-secondary text-sm">成本/费用</div>
                <div className="text-ink-primary mt-1 text-xl font-semibold tabular-nums md:text-2xl">
                  <AnimatedMoney value={data.expense} currency="CNY" />
                </div>
              </div>
              <div className="border-border bg-surface shadow-elevation-sm rounded-lg border p-4">
                <div className="text-ink-secondary text-sm">利润</div>
                <div className={`mt-1 text-xl font-semibold tabular-nums md:text-2xl ${
                  Number(data.profit) >= 0 ? "text-status-success-text" : "text-status-danger-text"
                }`}>
                  <AnimatedMoney value={data.profit} currency="CNY" />
                </div>
              </div>
            </div>
            <DetailTable<ProfitLine>
              columns={[
                { key: "account", header: "科目", render: (l) => <span className="font-medium">{l.code} {l.name}</span> },
                { key: "category", header: "类别", render: (l) => (l.category === "REVENUE" ? "收入" : "费用") },
                { key: "net", header: "期间净额", align: "right", render: (l) => formatMoney(l.net, "CNY") },
              ]}
              rows={data.lines}
              rowKey={(l) => l.code}
              emptyMessage="该期间暂无收入/费用发生额"
            />
          </>
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
