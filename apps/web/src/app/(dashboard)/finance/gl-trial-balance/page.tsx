"use client";

/** GL 试算平衡 — 只读页（Sprint 7 Finance，ADR-0034；实时聚合，余额为派生投影） */
// FRT-09：与利润表互链（利润表页无独立菜单入口，详见 PR body REGISTRY DELTA REQUIRED）
// FE2.0 UI-10：PageHeader 统一头部 + PageLoading 骨架屏 + DetailTable（金额右对齐 tabular-nums / sticky header）+ 借贷平衡 StatusBadge
import { useEffect, useState } from "react";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, ErrorPanel, PageHeader, DetailTable, StatusBadge } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { PageLoading } from "@/components/ui/skeleton";
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
      <PageHeader
        title="试算平衡"
        description="按科目实时聚合借贷发生额与余额（派生投影，事实源 = 记账凭证）"
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
          <Link aria-current="page" href="/finance/gl-trial-balance" className="rounded-md bg-brand-600 px-2.5 py-1 font-medium text-white">
            试算平衡
          </Link>
          <Link href="/finance/gl-profit-statement" className="rounded-md border border-border px-2.5 py-1 text-ink-secondary hover:bg-slate-50">
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
            <div
              className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
                data.inBalance
                  ? "border-status-success-border bg-status-success-bg text-status-success-text"
                  : "border-status-danger-border bg-status-danger-bg text-status-danger-text"
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <StatusBadge
                  status={data.inBalance ? "BALANCED" : "UNBALANCED"}
                  label={data.inBalance ? "借贷平衡" : "借贷不平衡"}
                  tone={data.inBalance ? "success" : "danger"}
                />
                <span>{data.inBalance ? "Σ借方 = Σ贷方" : "数据异常，请检查凭证"}</span>
              </span>
              <span className="tabular-nums">
                借方 {formatMoney(data.totals.debit, "CNY")} ／ 贷方 {formatMoney(data.totals.credit, "CNY")}
              </span>
            </div>
            <DetailTable<TrialLine>
              columns={[
                { key: "account", header: "科目", render: (l) => <span className="font-medium">{l.code} {l.name}</span> },
                { key: "category", header: "类别", render: (l) => CATEGORY_LABELS[l.category] ?? l.category },
                { key: "debit", header: "借方发生", align: "right", render: (l) => formatMoney(l.debit, "CNY") },
                { key: "credit", header: "贷方发生", align: "right", render: (l) => formatMoney(l.credit, "CNY") },
                { key: "balance", header: "余额", align: "right", render: (l) => formatMoney(l.balance, "CNY") },
              ]}
              rows={data.lines}
              rowKey={(l) => l.accountId}
              emptyMessage="该期间暂无科目发生额"
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
      <TrialBalanceView />
    </PermissionGuard>
  );
}
