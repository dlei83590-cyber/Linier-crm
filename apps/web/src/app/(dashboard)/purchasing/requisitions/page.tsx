"use client";

/**
 * Purchase Requisitions — 采购申请列表页（F2-3 Batch C1 Consolidation，CTO #11888）
 *
 * 由旧式自绘 table/filter 迁移至统一 Workspace：
 * AppPage → EntityListWorkspace → StatusBadge / ErrorPanel / common toolbar。
 * 不改 backend / 状态机 / action；业务逻辑（useListQuery + filters）原样保留。
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge, ConfirmActionDialog, ModuleKpiStrip } from "@/components/workspace";
import type { ModuleSummaryData } from "@/lib/module-summary/types";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery, readUrlFilterParams } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";

interface RequisitionRow {
  id: string;
  code: string;
  status: string;
  needDate?: string | null;
  requester?: { name: string | null } | null;
  department?: { name: string | null } | null;
  _count?: { lines: number };
}

const STATUS_OPTIONS = ["DRAFT", "SUBMITTED", "APPROVED", "CONVERTED", "CANCELLED"] as const;

/** 状态中文业务名（Business UX Rationalization：枚举展示中文，不展示数据库枚举值；key 保留真实 enum） */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "已提交",
  APPROVED: "已批准",
  CONVERTED: "已转采购订单",
  CANCELLED: "已取消",
};

function RequisitionList() {
  const { state } = useSession();
  const toast = useToast();
  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("purchase-requisition", "create"));
  const canEdit = hasPermission(roles, actionPermission("purchase-requisition", "edit"));
  const canDelete = hasPermission(roles, actionPermission("purchase-requisition", "delete"));
  const [codeInput, setCodeInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ code?: string; status?: string }>({});
  const [deleting, setDeleting] = useState<RequisitionRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [unconverting, setUnconverting] = useState<RequisitionRow | null>(null);
  const [unconvertBusy, setUnconvertBusy] = useState(false);

  const [summary, setSummary] = useState<ModuleSummaryData | null>(null);

  // 页面仪表盘 KPI：只读汇总（GET /api/purchase-requisitions/summary）；失败静默隐藏
  useEffect(() => {
    let cancelled = false;
    apiFetch<ModuleSummaryData>("/api/purchase-requisitions/summary")
      .then((b) => {
        if (!cancelled) setSummary(b.data);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 仪表盘卡片点击：联动列表状态筛选（保留单号筛选）
  const selectStatus = (status: string | null) => {
    setStatusInput(status ?? "");
    setFilters((prev) => {
      const next = { ...prev };
      if (status) next.status = status;
      else delete next.status;
      return next;
    });
    setPage(1);
  };

  const { items, total, page, pageSize, loading, error, setPage, setPageSize, refresh } =
    useListQuery<RequisitionRow>("/api/purchase-requisitions", filters, 20, { syncUrl: true });

  // URL 筛选恢复（hydration 后一次性应用；刷新/分享后筛选不丢失）
  const urlRestored = useRef(false);
  useEffect(() => {
    if (urlRestored.current) return;
    urlRestored.current = true;
    const u = readUrlFilterParams(["code", "status"]);
    setCodeInput(u.code ?? "");
    setStatusInput(u.status ?? "");
    setFilters(() => {
      const n: { code?: string; status?: string } = {};
      if (u.code) n.code = u.code;
      if (u.status) n.status = u.status;
      return n;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilter = () => {
    const next: { code?: string; status?: string } = {};
    if (codeInput.trim()) next.code = codeInput.trim();
    if (statusInput) next.status = statusInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setCodeInput("");
    setStatusInput("");
    setFilters({});
    setPage(1);
  };

  const runDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await apiFetch("/api/purchase-requisitions/" + deleting.id, { method: "DELETE" });
      toast.success("采购申请已删除");
      setDeleting(null);
      refresh();
    } catch (err) {
      const e = err instanceof ApiClientError ? err : new ApiClientError(0, "删除失败", "NETWORK_ERROR");
      toast.error("删除失败", e.message);
      setDeleting(null);
      refresh();
    } finally {
      setDeleteBusy(false);
    }
  };

  const runUnconvert = async () => {
    if (!unconverting || unconvertBusy) return;
    setUnconvertBusy(true);
    try {
      await apiFetch("/api/purchase-requisitions/" + unconverting.id + "/unconvert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changeReason: "回退（取消转单）" }),
      });
      toast.success("已回退（转单取消，可重新转单/编辑）");
      setUnconverting(null);
      refresh();
    } catch (err) {
      const e = err instanceof ApiClientError ? err : new ApiClientError(0, "回退失败", "NETWORK_ERROR");
      toast.error("回退失败", e.message);
      setUnconverting(null);
      refresh();
    } finally {
      setUnconvertBusy(false);
    }
  };

  return (
    <AppPage>
      <ModuleKpiStrip
        statuses={STATUS_OPTIONS.map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s }))}
        data={summary}
        activeStatus={filters.status ?? null}
        onSelectStatus={selectStatus}
      />
      <EntityListWorkspace<RequisitionRow>
        title="采购申请"
        description="采购申请仪表盘"
        emptyMessage="暂无采购申请——点击「+ 新建采购申请」创建第一张采购申请"
        headerActions={
          canCreate ? (
            <Link
              href="/purchasing/requisitions/new"
              className={BUTTON_PRIMARY_CLASS}
            >
              + 新建采购申请
            </Link>
          ) : undefined
        }
        filters={
          <>
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按单号搜索"
              className={"w-40 " + SELECT_CLASS}
            />
            <select
              value={statusInput}
              onChange={(e) => setStatusInput(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">全部状态</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s] ?? s}
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
              <Link
                href={`/purchasing/requisitions/${row.id}`}
                className="font-medium text-brand-600 hover:underline"
              >
                {row.code}
              </Link>
            ),
          },
          {
            key: "status",
            header: "状态",
            render: (row) => (
              <StatusBadge status={row.status} label={STATUS_LABELS[row.status] ?? row.status} />
            ),
          },
          {
            key: "requester",
            header: "申请人",
            render: (row) => row.requester?.name ?? "—",
          },
          {
            key: "department",
            header: "部门",
            render: (row) => row.department?.name ?? "—",
          },
          {
            key: "lines",
            header: "行数",
            render: (row) => String(row._count?.lines ?? 0),
          },
          {
            key: "needDate",
            header: "期望需求日期",
            render: (row) => formatDate(row.needDate),
          },
          {
            key: "actions",
            header: "操作",
            render: (row) => (
              <div className="flex items-center gap-2">
                {row.status === "CONVERTED" && canEdit && (
                  <button
                    type="button"
                    onClick={() => setUnconverting(row)}
                    disabled={unconvertBusy || deleteBusy}
                    className="rounded-md border border-border px-2 py-1 text-xs text-ink-primary hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {unconvertBusy && unconverting?.id === row.id ? "回退中…" : "回退"}
                  </button>
                )}
                {["DRAFT", "SUBMITTED", "CANCELLED"].includes(row.status) && canDelete && (
                  <button
                    type="button"
                    onClick={() => setDeleting(row)}
                    disabled={unconvertBusy || deleteBusy}
                    className="rounded-md border border-status-danger-border px-2 py-1 text-xs text-status-danger-text hover:bg-status-danger-bg/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    删除
                  </button>
                )}
              </div>
            ),
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
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        activeFilters={[
          filters.code
            ? {
                key: "code",
                label: `单号：${filters.code}`,
                onClear: () => {
                  setCodeInput("");
                  setFilters((prev) => {
                    const n = { ...prev };
                    delete n.code;
                    return n;
                  });
                },
              }
            : null,
          filters.status
            ? {
                key: "status",
                label: `状态：${STATUS_LABELS[filters.status] ?? filters.status}`,
                onClear: () => {
                  setStatusInput("");
                  setFilters((prev) => {
                    const n = { ...prev };
                    delete n.status;
                    return n;
                  });
                },
              }
            : null,
        ].filter((c): c is NonNullable<typeof c> => c !== null)}
      />

      <ConfirmActionDialog
        open={deleting !== null}
        title={"删除采购申请「" + (deleting?.code ?? "") + "」？"}
        description="仅草稿/已提交/已取消状态的采购申请可删除（无关联采购订单时）；删除后列表不再展示。"
        confirmLabel="确认删除"
        tone="danger"
        busy={deleteBusy}
        onConfirm={runDelete}
        onCancel={() => setDeleting(null)}
      />

      <ConfirmActionDialog
        open={unconverting !== null}
        title={"回退采购申请「" + (unconverting?.code ?? "") + "」？"}
        description="回退（CONVERTED → 已批准）：取消转单标记，可重新转单/编辑。要求关联采购订单均已删除。"
        confirmLabel="确认回退"
        tone="danger"
        busy={unconvertBusy}
        onConfirm={runUnconvert}
        onCancel={() => setUnconverting(null)}
      />
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.PURCHASE_REQUISITION_READ}>
      <RequisitionList />
    </PermissionGuard>
  );
}