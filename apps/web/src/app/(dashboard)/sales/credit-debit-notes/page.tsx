"use client";

/**
 * Credit/Debit Notes — 贷项/借项通知单列表页（F2-6B 批 2）
 *
 * 只读 List + 状态动作：AppPage → EntityListWorkspace → useListQuery。
 * 消费 FINAL 契约 GET /api/credit-debit-notes（分页 + status/noteType/customerId 过滤）。
 * 动作（状态 Gate + 权限 Gate，忠实表达后端状态机）：
 *  - 提交 submit（credit-debit-note:edit）：仅 DRAFT；命中审批策略则进入 PENDING。
 *  - 应用 apply（credit-debit-note:approve）：仅 SUBMITTED；若命中审批须 approvalStatus=APPROVED
 *    （APPROVED ≠ APPLIED——后端仍以 409 CN_DN_APPROVAL_REQUIRED 兜底）。
 * 无详情 GET 端点（/api/credit-debit-notes/{id} 仅 submit/apply），故列表内联操作 + 明细展开。
 * PermissionGuard 对齐 API requirePermission("credit-debit-note:view")。
 */
import { useState } from "react";
import Link from "next/link";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import type { StatusTone } from "@/components/design-system";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { useSession } from "@/lib/session-context";
import { formatDate, formatMoney } from "@/lib/format";

interface CnDnLine {
  id: string;
  lineNo: number;
  description?: string | null;
  quantity: string;
  totalAmount: string;
  item?: { id: string; code: string | null; name: string | null } | null;
}

interface CnDnRow {
  id: string;
  code: string;
  noteType: string;
  status: string;
  approvalStatus?: string | null;
  workflowInstanceId?: string | null;
  adjustmentTotal: string;
  currency: string;
  reason?: string | null;
  createdAt: string;
  appliedAt?: string | null;
  sourceInvoice?: { id: string; code: string | null; invoiceTotal: string; balanceAmount: string } | null;
  lines?: CnDnLine[];
}

const STATUS_OPTIONS = ["DRAFT", "SUBMITTED", "APPLIED"] as const;
const NOTE_TYPE_OPTIONS = ["CREDIT", "DEBIT"] as const;

const NOTE_TYPE_LABEL: Record<string, string> = {
  CREDIT: "贷项（冲减应收）",
  DEBIT: "借项（正向调整）",
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "已提交",
  APPLIED: "已应用",
};

const TONE_MAP: Record<string, StatusTone> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  APPLIED: "success",
};

const APPROVAL_TONE: Record<string, StatusTone> = {
  DRAFT: "neutral",
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

interface ConfirmTarget {
  type: "submit" | "apply";
  id: string;
  code: string;
}

function CnDnList() {
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("credit-debit-note", "create"));
  const canEdit = hasPermission(
    state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [],
    actionPermission("credit-debit-note", "edit"),
  );
  const canApprove = hasPermission(
    state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [],
    actionPermission("credit-debit-note", "approve"),
  );

  const [statusInput, setStatusInput] = useState("");
  const [noteTypeInput, setNoteTypeInput] = useState("");
  const [filters, setFilters] = useState<{ status?: string; noteType?: string }>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ApiClientError | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<CnDnRow>("/api/credit-debit-notes", filters);

  const applyFilter = () => {
    const next: { status?: string; noteType?: string } = {};
    if (statusInput) next.status = statusInput;
    if (noteTypeInput) next.noteType = noteTypeInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setStatusInput("");
    setNoteTypeInput("");
    setFilters({});
    setPage(1);
  };

  const applyPending = (row: CnDnRow): boolean =>
    Boolean(row.workflowInstanceId) && row.approvalStatus !== "APPROVED";

  const canApplyRow = (row: CnDnRow): boolean =>
    row.status === "SUBMITTED" && !applyPending(row);

  const runAction = async (target: ConfirmTarget) => {
    setBusyKey(`${target.id}:${target.type}`);
    setActionError(null);
    try {
      if (target.type === "submit") {
        await apiFetch(`/api/credit-debit-notes/${target.id}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ changeReason: "提交生效" }),
        });
      } else {
        await apiFetch(`/api/credit-debit-notes/${target.id}/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ changeReason: "应用到应收" }),
        });
      }
      refresh();
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "操作失败", "NETWORK_ERROR"),
      );
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <AppPage>
      {actionError && (
        <div className="border-status-danger-border mb-3 rounded-md border bg-status-danger-bg/10 p-3 text-sm text-status-danger-text">
          {describeStatus(actionError.status)}：{actionError.message}
          {actionError.code ? `（${actionError.code}）` : ""}
        </div>
      )}
      <EntityListWorkspace<CnDnRow>
        title="贷项/借项通知单"
        description="发票调整（冲减/调整应收）单据"
        headerActions={
          canCreate ? (
            <Link
              href="/sales/credit-debit-notes/new"
              className={BUTTON_PRIMARY_CLASS}
            >
              + 新建通知单
            </Link>
          ) : undefined
        }
        filters={
          <>
            <select
              value={statusInput}
              onChange={(e) => setStatusInput(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">全部状态</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s] ?? s}
                </option>
              ))}
            </select>
            <select
              value={noteTypeInput}
              onChange={(e) => setNoteTypeInput(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">全部类型</option>
              {NOTE_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {NOTE_TYPE_LABEL[t]}（{t}）
                </option>
              ))}
            </select>
          </>
        }
        toolbarActions={
          <>
            <button
              type="button"
              onClick={applyFilter}
              className={BUTTON_PRIMARY_CLASS}
            >
              查询
            </button>
            <button
              type="button"
              onClick={resetFilter}
              className={BUTTON_SECONDARY_CLASS}
            >
              重置
            </button>
          </>
        }
        columns={[
          {
            key: "code",
            header: "单号",
            render: (row) => (
              <button
                type="button"
                onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                className="font-medium text-brand-600 hover:underline"
              >
                {row.code}
              </button>
            ),
          },
          {
            key: "noteType",
            header: "类型",
            render: (row) => NOTE_TYPE_LABEL[row.noteType] ?? row.noteType,
          },
          {
            key: "status",
            header: "状态",
            render: (row) => (
              <StatusBadge status={row.status} label={STATUS_LABEL[row.status] ?? row.status} toneMap={TONE_MAP} />
            ),
          },
          {
            key: "approvalStatus",
            header: "审批状态",
            render: (row) =>
              row.workflowInstanceId ? (
                <StatusBadge
                  status={row.approvalStatus ?? "DRAFT"}
                  toneMap={APPROVAL_TONE}
                />
              ) : (
                <span className="text-ink-muted text-xs">无需审批</span>
              ),
          },
          {
            key: "sourceInvoice",
            header: "源发票",
            render: (row) => row.sourceInvoice?.code ?? "—",
          },
          {
            key: "adjustmentTotal",
            header: "调整金额",
            align: "right",
            render: (row) => formatMoney(row.adjustmentTotal, row.currency),
          },
          {
            key: "reason",
            header: "原因",
            render: (row) => row.reason ?? "—",
          },
          {
            key: "actions",
            header: "操作",
            render: (row) => {
              const busy = busyKey !== null;
              return (
                <div className="flex items-center gap-2">
                  {row.status === "DRAFT" && canEdit && (
                    <button
                      type="button"
                      onClick={() => setConfirmTarget({ type: "submit", id: row.id, code: row.code })}
                      disabled={busy}
                      className="rounded-md border border-border px-2 py-1 text-xs text-ink-primary hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {busyKey === `${row.id}:submit` ? "提交中…" : "提交"}
                    </button>
                  )}
                  {row.status === "SUBMITTED" && canApprove && (
                    <button
                      type="button"
                      onClick={() => setConfirmTarget({ type: "apply", id: row.id, code: row.code })}
                      disabled={busy || !canApplyRow(row)}
                      title={applyPending(row) ? "待审批通过后才能应用" : undefined}
                      className="rounded-md bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {busyKey === `${row.id}:apply` ? "应用中…" : "应用"}
                    </button>
                  )}
                </div>
              );
            },
          },
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
        footer={
          expandedId ? (
            <div className="border-border border-t px-4 py-4 md:px-6">
              {(() => {
                const row = items.find((r) => r.id === expandedId);
                if (!row) return null;
                return (
                  <div>
                    <div className="mb-3 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                      <div>
                        <p className="text-xs text-ink-muted">单号</p>
                        <p className="text-ink-primary mt-0.5">{row.code}</p>
                      </div>
                      <div>
                        <p className="text-xs text-ink-muted">源发票</p>
                        <p className="text-ink-primary mt-0.5">{row.sourceInvoice?.code ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-ink-muted">调整金额</p>
                        <p className="text-ink-primary mt-0.5">
                          {formatMoney(row.adjustmentTotal, row.currency)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-ink-muted">应用日期</p>
                        <p className="text-ink-primary mt-0.5">{formatDate(row.appliedAt)}</p>
                      </div>
                      <div className="col-span-2 md:col-span-4">
                        <p className="text-xs text-ink-muted">原因</p>
                        <p className="text-ink-primary mt-0.5">{row.reason ?? "—"}</p>
                      </div>
                    </div>
                    <table className="divide-border min-w-full divide-y text-sm">
                      <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
                        <tr>
                          <th className="px-3 py-2 font-medium">行号</th>
                          <th className="px-3 py-2 font-medium">物料</th>
                          <th className="px-3 py-2 font-medium">描述</th>
                          <th className="px-3 py-2 font-medium">调整数量</th>
                          <th className="px-3 py-2 font-medium">行金额（快照）</th>
                        </tr>
                      </thead>
                      <tbody className="divide-border divide-y">
                        {(row.lines ?? []).map((line) => (
                          <tr key={line.id}>
                            <td className="px-3 py-2 text-ink-secondary">{line.lineNo}</td>
                            <td className="px-3 py-2 text-ink-primary">
                              {line.item ? `${line.item.code ?? ""} ${line.item.name ?? ""}`.trim() : "—"}
                            </td>
                            <td className="px-3 py-2 text-ink-secondary">{line.description ?? "—"}</td>
                            <td className="px-3 py-2 text-ink-primary">{line.quantity}</td>
                            <td className="px-3 py-2 text-ink-secondary">
                              {formatMoney(line.totalAmount, row.currency)}
                            </td>
                          </tr>
                        ))}
                        {(row.lines ?? []).length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-3 py-8 text-center text-sm text-ink-muted">
                              暂无明细行
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          ) : undefined
        }
      />

      {/* ── 动作确认对话框 ── */}
      {confirmTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setConfirmTarget(null)}
        >
          <div
            className="border-border bg-surface shadow-elevation-lg w-full max-w-md rounded-lg border p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-ink-primary text-base font-semibold">
              {confirmTarget.type === "submit" ? "提交通知单" : "应用通知单"}
            </h2>
            <p className="text-ink-secondary mt-2 text-sm">
              {confirmTarget.type === "submit"
                ? `提交 ${confirmTarget.code}？提交即生效（已自动批准），可继续应用。`
                : `将 ${confirmTarget.code} 应用到应收（产生不可逆财务事实，APPROVED ≠ APPLIED）？`}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmTarget(null)}
                disabled={busyKey !== null}
                className="border-border text-ink-secondary rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const t = confirmTarget;
                  setConfirmTarget(null);
                  if (t) void runAction(t);
                }}
                disabled={busyKey !== null}
                className={
                  confirmTarget.type === "apply"
                    ? "rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    : "bg-brand-600 hover:bg-brand-700 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                }
              >
                {busyKey !== null ? "处理中…" : "确认"}
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
    <PermissionGuard permission={actionPermission("credit-debit-note", "view")}>
      <CnDnList />
    </PermissionGuard>
  );
}