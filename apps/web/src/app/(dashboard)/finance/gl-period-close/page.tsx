"use client";

/** GL 期末结转 — 期间选择 + 已结转列表（Sprint 7 Finance，ADR-0036；收入/费用 → 本年利润） */
import { useState } from "react";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";

interface PeriodCloseRow {
  id: string;
  periodKey: string;
  closedAt: string;
  journalEntry?: { id: string; voucherNo: string | null } | null;
}

interface CloseResult {
  periodKey: string;
  journalEntryId: string;
  voucherNo: string | null;
  revenueNet: string;
  expenseNet: string;
  profit: string;
}

function PeriodCloseView() {
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];
  const canOperate = hasPermission(roles, actionPermission("gl", "create"));
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<ApiClientError | null>(null);
  const [lastResult, setLastResult] = useState<CloseResult | null>(null);
  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<PeriodCloseRow>("/api/gl/period-closes", {});

  const [reopeningId, setReopeningId] = useState<string | null>(null);

  const handleReopen = (row: PeriodCloseRow) => {
    if (reopeningId || !window.confirm(`确认重开期间 ${row.periodKey}？将生成红字冲销结转凭证`)) return;
    setReopeningId(row.id);
    apiFetch<{ periodKey: string }>(`/api/gl/period-closes/${row.id}/reopen`, {
      method: "POST",
      body: JSON.stringify({}),
    })
      .then(() => { setReopeningId(null); refresh(); })
      .catch((err: unknown) => {
        alert(err instanceof ApiClientError ? err.message : "重开失败");
        setReopeningId(null);
      });
  };

  const handleClose = () => {
    if (closing) return;
    setClosing(true);
    setCloseError(null);
    apiFetch<CloseResult>("/api/gl/month-end-close", {
      method: "POST",
      body: JSON.stringify({ period }),
    })
      .then((body) => { setLastResult(body.data); refresh(); setClosing(false); })
      .catch((err: unknown) => {
        setCloseError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setClosing(false);
      });
  };

  return (
    <AppPage>
      <div className="px-4 pt-4">
        <h1 className="text-lg font-semibold text-ink-primary">期末结转（月结）</h1>
        <p className="text-sm text-ink-secondary">收入/费用科目结转到本年利润（4103）；同期间仅允许结转一次（防重复）</p>
      </div>
      <div className="p-4">
        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-md border border-border p-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-ink-secondary">结转期间（YYYY-MM）</span>
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-44 rounded-md border border-border px-3 py-1.5 text-sm" />
          </label>
          {canOperate ? (
            <button type="button" onClick={handleClose} disabled={closing} className={BUTTON_PRIMARY_CLASS}>
              {closing ? "结转中…" : "执行结转"}
            </button>
          ) : null}
          {closeError ? <p className="text-sm text-status-danger-text">{closeError.message}</p> : null}
        </div>
        {lastResult ? (
          <div className="mb-4 rounded-md border border-status-success-border bg-status-success-bg p-3 text-sm text-status-success-text">
            结转完成：期间 {lastResult.periodKey} ｜ 凭证 {lastResult.voucherNo ?? "—"} ｜ 收入净额 {lastResult.revenueNet} ｜ 费用净额 {lastResult.expenseNet} ｜ 本年利润 {lastResult.profit}
            <Link href={`/finance/gl-journal-entries/${lastResult.journalEntryId}`} className="ml-2 font-medium underline">查看凭证</Link>
          </div>
        ) : null}
        <EntityListWorkspace<PeriodCloseRow>
          title="已结转期间"
          description=""
          columns={[
            { key: "periodKey", header: "期间" },
            { key: "journalEntry", header: "结转凭证", render: (row) => (row.journalEntry ? <Link href={`/finance/gl-journal-entries/${row.journalEntry.id}`} className="font-medium text-brand-600 hover:underline">{row.journalEntry.voucherNo ?? "—"}</Link> : "—") },
            { key: "closedAt", header: "结转时间", render: (row) => formatDate(row.closedAt) },
            { key: "status", header: "状态", render: () => (<StatusBadge status="CLOSED" label="已结转" toneMap={{ CLOSED: "success" }} />) },
            { key: "actions", header: "操作", render: (row) => (canOperate ? <button type="button" onClick={() => handleReopen(row)} disabled={reopeningId !== null} className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary hover:bg-canvas disabled:opacity-50">{reopeningId === row.id ? "重开中…" : "重开"}</button> : "—") },
          ]}
          rows={items}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={refresh}
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
        />
      </div>
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("gl", "view")}>
      <PeriodCloseView />
    </PermissionGuard>
  );
}