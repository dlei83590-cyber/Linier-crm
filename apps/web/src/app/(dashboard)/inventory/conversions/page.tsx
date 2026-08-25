"use client";

/**
 * Inventory Conversions — 库存转换列表页（F2-3 Batch C2 Consolidation，CTO #11888）
 *
 * 由旧式自绘 table/filter 迁移至统一 Workspace：
 * AppPage → EntityListWorkspace → StatusBadge / ErrorPanel / common toolbar。
 * 不改 backend / 状态机 / action；useListQuery + filters 原样保留。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { hasPermission, actionPermission, PERMISSIONS, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { AppPage, EntityListWorkspace, StatusBadge, ConfirmActionDialog, ModuleKpiStrip } from "@/components/workspace";
import type { ModuleSummaryData } from "@/lib/module-summary/types";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";

interface ConversionRow {
  id: string;
  conversionNo: string;
  status: string;
  executedAt?: string | null;
  item?: { code: string | null; name: string | null } | null;
  baseUom?: { symbol: string | null } | null;
  _count?: { lines: number };
}

const STATUS_OPTIONS = ["DRAFT", "SUBMITTED", "EXECUTED", "CANCELLED"] as const;

/** 状态中文业务名（Business UX Rationalization：枚举展示中文，不展示数据库枚举值；key 保留真实 enum） */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "已提交",
  EXECUTED: "已执行",
  CANCELLED: "已取消",
};

function ConversionList() {
  const { state } = useSession();
  const toast = useToast();
  const roles = state.status === "authenticated" && state.user ? (state.user.roles as RoleCode[]) : [];
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("inventory-conversion", "create"));
  const canDelete = hasPermission(roles, actionPermission("inventory-conversion", "delete"));
  const [noInput, setNoInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ conversionNo?: string; status?: string }>({});
  const [deleting, setDeleting] = useState<ConversionRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [summary, setSummary] = useState<ModuleSummaryData | null>(null);

  // 页面仪表盘 KPI：只读汇总（GET /api/inventory-conversions/summary）；失败静默隐藏
  useEffect(() => {
    let cancelled = false;
    apiFetch<ModuleSummaryData>("/api/inventory-conversions/summary")
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

  // 仪表盘卡片点击：联动列表状态筛选（保留其他筛选）
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

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<ConversionRow>("/api/inventory-conversions", filters);

  const applyFilter = () => {
    const next: { conversionNo?: string; status?: string } = {};
    if (noInput.trim()) next.conversionNo = noInput.trim();
    if (statusInput) next.status = statusInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setNoInput("");
    setStatusInput("");
    setFilters({});
    setPage(1);
  };

  const runDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await apiFetch("/api/inventory-conversions/" + deleting.id, { method: "DELETE" });
      toast.success("转换单已删除");
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

  return (
    <AppPage>
      <ModuleKpiStrip
        statuses={STATUS_OPTIONS.map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s }))}
        data={summary}
        activeStatus={filters.status ?? null}
        onSelectStatus={selectStatus}
      />
      <EntityListWorkspace<ConversionRow>
        title="库存转换"
        description="库存转换仪表盘"
        emptyMessage="暂无转换单——点击「+ 新建」创建第一张"
        headerActions={
          canCreate ? (
            <Link
              href="/inventory/conversions/new"
              className={BUTTON_PRIMARY_CLASS}
            >
              + 新建转换单
            </Link>
          ) : undefined
        }
        filters={
          <>
            <input
              value={noInput}
              onChange={(e) => setNoInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按转换单号搜索"
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
            key: "conversionNo",
            header: "转换单号",
            render: (row) => (
              <Link
                href={`/inventory/conversions/${row.id}`}
                className="font-medium text-brand-600 hover:underline"
              >
                {row.conversionNo}
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
            key: "item",
            header: "物料",
            render: (row) =>
              row.item ? `${row.item.code ?? ""} ${row.item.name ?? ""}`.trim() : "—",
          },
          {
            key: "baseUom",
            header: "基准单位",
            render: (row) => row.baseUom?.symbol ?? "—",
          },
          {
            key: "lines",
            header: "行数",
            align: "right",
            render: (row) => String(row._count?.lines ?? 0),
          },
          {
            key: "executedAt",
            header: "执行日期",
            render: (row) => formatDate(row.executedAt),
          },
        ]
        rows={items}
        rowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={refresh}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        rowActions={
          canDelete
            ? (row) =>
                ["DRAFT", "CANCELLED"].includes(row.status) ? (
                  <button
                    type="button"
                    onClick={() => setDeleting(row)}
                    disabled={deleteBusy}
                    className="rounded-md border border-status-danger-border px-2 py-1 text-xs text-status-danger-text hover:bg-status-danger-bg/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    删除
                  </button>
                ) : null
            : undefined
        }
      />

      <ConfirmActionDialog
        open={deleting !== null}
        title={"删除转换单「" + (deleting?.conversionNo ?? "") + "」？"}
        description="仅草稿/已取消状态的转换单可删除；删除后列表不再展示。"
        confirmLabel="确认删除"
        tone="danger"
        busy={deleteBusy}
        onConfirm={runDelete}
        onCancel={() => setDeleting(null)}
      />
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.INVENTORY_CONVERSION_READ}>
      <ConversionList />
    </PermissionGuard>
  );
}