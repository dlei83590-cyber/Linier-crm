"use client";

/**
 * 绩效数据固定页（feat(crm) MVP）— /reports/performance
 *
 * 只统计客观事实（新增客户/拜访/商机/报价/成交订单/成交金额），按员工分组，筛选 本周/本月。
 * 数据源缺失（如 CRM 跟进模型未建立）→ 该列显示「暂无事实数据」；禁止 mock / 主观评分 / 权重 / 奖金算法。
 */
import { useCallback, useEffect, useState } from "react";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { SELECT_CLASS } from "@/lib/ui-classes";

type Period = "week" | "month";

interface PerformanceRow {
  userId: string;
  userName: string;
  userEmail: string;
  departmentName: string | null;
  newCustomerCount: number;
  followUpCount: number | null;
  visitCount: number;
  opportunityCount: number;
  quotationCount: number;
  salesOrderCount: number;
  salesAmount: string;
}

interface PerformanceData {
  period: Period;
  from: string;
  to: string;
  dataSources: Record<string, boolean>;
  rows: PerformanceRow[];
}

function PerformanceBoard() {
  const [period, setPeriod] = useState<Period>("week");
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  const load = useCallback((p: Period) => {
    setLoading(true);
    setError(null);
    apiFetch<PerformanceData>("/api/reports/performance?period=" + p)
      .then((body) => setData(body.data))
      .catch((err: unknown) => setError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载失败", "NETWORK_ERROR")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(period);
  }, [period, load]);

  return (
    <AppPage>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">绩效数据</h1>
          <p className="mt-1 text-sm text-ink-muted">客观业务事实统计（本周/本月）；数据源缺失列显示「暂无事实数据」</p>
        </div>
        <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className={SELECT_CLASS}>
          <option value="week">本周</option>
          <option value="month">本月</option>
        </select>
      </div>

      {error && <ErrorPanel error={error} onRetry={() => load(period)} />}

      {loading ? (
        <p className="text-sm text-ink-muted">加载中…</p>
      ) : data ? (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface text-xs text-ink-muted">
                <th className="px-4 py-2">员工</th>
                <th className="px-4 py-2">部门</th>
                <th className="px-4 py-2 tabular-nums">新增客户</th>
                <th className="px-4 py-2 tabular-nums">跟进次数</th>
                <th className="px-4 py-2 tabular-nums">拜访次数</th>
                <th className="px-4 py-2 tabular-nums">商机数</th>
                <th className="px-4 py-2 tabular-nums">报价数</th>
                <th className="px-4 py-2 tabular-nums">成交订单</th>
                <th className="px-4 py-2 tabular-nums">成交金额</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.rows.map((r) => (
                <tr key={r.userId}>
                  <td className="px-4 py-2">{r.userName}</td>
                  <td className="px-4 py-2 text-ink-muted">{r.departmentName ?? "—"}</td>
                  <td className="px-4 py-2 tabular-nums">{r.newCustomerCount}</td>
                  <td className="px-4 py-2 tabular-nums text-ink-muted">
                    {data.dataSources.followUps ? (r.followUpCount ?? 0) : "暂无事实数据"}
                  </td>
                  <td className="px-4 py-2 tabular-nums">{r.visitCount}</td>
                  <td className="px-4 py-2 tabular-nums">{r.opportunityCount}</td>
                  <td className="px-4 py-2 tabular-nums">{r.quotationCount}</td>
                  <td className="px-4 py-2 tabular-nums">{r.salesOrderCount}</td>
                  <td className="px-4 py-2 tabular-nums">{Number(r.salesAmount).toLocaleString("zh-CN")}</td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-sm text-ink-muted">
                    暂无员工数据。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("reports", "view")}>
      <PerformanceBoard />
    </PermissionGuard>
  );
}
