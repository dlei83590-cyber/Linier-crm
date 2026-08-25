"use client";

/**
 * Receipts — 收款核销列表页（F2-6B 批 2：收款核销前端补全）
 *
 * 只读 List：AppPage → EntityListWorkspace → useListQuery。
 * 消费 FINAL 契约 GET /api/receipts（分页 + customerId/status/currency 过滤）。
 * 提供「新建收款单」入口（receipt:create）。
 * PermissionGuard 对齐 API requirePermission("receipt:view")。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge, ConfirmActionDialog, ModuleKpiStrip } from "@/components/workspace";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import type { ModuleSummaryData } from "@/lib/module-summary/types";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { SALES_STATUS_OPTIONS, salesStatusLabel, salesStatusTone } from "@/lib/sales-status";
import { useListQuery } from "@/lib/use-list-query";
import { useSession } from "@/lib/session-context";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatMoney } from "@/lib/format";

interface ReceiptRow {
  id: string;
  code: string;
  status: string;
  amount: string;
  allocatedAmount: string;
  unallocatedAmount: string;
  receiptDate: string;
  currency: string;
  paymentMethod?: string | null;
  customer?: { id: string; code: string | null; name: string | null } | null;
  _count?: { allocations: number };
}

function ReceiptList() {
  const router = useRouter();
  const toast = useToast();
  const { state } = useSession();
  const canDelete = hasPermission((state.user?.roles ?? []) as RoleCode[], actionPermission("receipt", "delete"));
  const [deleting, setDeleting] = useState<ReceiptRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("receipt", "create"));
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ status?: string }>({});

  const [summary, setSummary] = useState<ModuleSummaryData | null>(null);

  // 页面仪表盘 KPI：只读汇总（GET /api/receipts/summary）；失败静默隐藏
  useEffect(() => {
    let cancelled = false;
    apiFetch<ModuleSummaryData>("/api/receipts/summary")
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
    useListQuery<ReceiptRow>("/api/receipts", filters);

  const applyFilter = () => {
    setFilters(statusInput ? { status: statusInput } : {});
    setPage(1);
  };

  const resetFilter = () => {
    setStatusInput("");
    setFilters({});
    setPage(1);
  };

  const runDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await apiFetch("/api/receipts/" + deleting.id, { method: "DELETE" });
      toast.success("收款单已删除");
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
        statuses={SALES_STATUS_OPTIONS.receipt.map((s) => ({ value: s, label: salesStatusLabel("receipt", s) }))}
        data={summary}
        activeStatus={filters.status ?? null}
        onSelectStatus={selectStatus}
      />
      <EntityListWorkspace<ReceiptRow>
        title="收款核销"
        description="收款单登记、核销与作废"
        headerActions={
          canCreate ? (
            <Link
              href="/sales/receipts/new"
              className={BUTTON_PRIMARY_CLASS}
            >
              + 新建收款单
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
              {SALES_STATUS_OPTIONS.receipt.map((s) => (
                <option key={s} value={s}>
                  {salesStatusLabel("receipt", s)}
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
                href={`/sales/receipts/${row.id}`}
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
              <StatusBadge
                status={row.status}
                label={salesStatusLabel("receipt", row.status)}
                tone={salesStatusTone("receipt", row.status)}
              />
            ),
          },
          {
            key: "customer",
            header: "客户",
            render: (row) => row.customer?.name ?? "—",
          },
          {
            key: "receiptDate",
            header: "收款日期",
            render: (row) => formatDate(row.receiptDate),
          },
          {
            key: "amount",
            header: "收款金额",
            align: "right",
            render: (row) => formatMoney(row.amount, row.currency),
          },
          {
            key: "allocatedAmount",
            header: "已核销",
            align: "right",
            render: (row) => formatMoney(row.allocatedAmount, row.currency),
          },
          {
            key: "unallocatedAmount",
            header: "未核销",
            align: "right",
            render: (row) => formatMoney(row.unallocatedAmount, row.currency),
          },
          {
            key: "allocations",
            header: "核销笔数",
            render: (row) => String(row._count?.allocations ?? 0),
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
        rowActions={(row) => (
          <RowActionsMenu
            actions={[
              { key: "view", label: "查看详情", onSelect: () => router.push("/sales/receipts/" + row.id) },
              ...(canDelete && row.status === "VOIDED"
                ? [{ key: "delete", label: "删除", tone: "danger" as const, onSelect: () => setDeleting(row) }]
                : []),
            ]}
          />
        )}
      />
      <ConfirmActionDialog
        open={deleting !== null}
        title={"删除收款单「" + (deleting?.code ?? "") + "」？"}
        description="仅已作废（VOIDED）且无核销记录的收款单可删除（回退后清理列表）。"
        confirmLabel="删除"
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
    <PermissionGuard permission={actionPermission("receipt", "view")}>
      <ReceiptList />
    </PermissionGuard>
  );
}