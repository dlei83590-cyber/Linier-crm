"use client";

/**
 * Quotations — 报价单列表页（F2-6A Sales Read Foundation，CTO FINAL APPROVED 后启动）
 *
 * 只读 List：AppPage → EntityListWorkspace → useListQuery。
 * 不改 backend / 状态机 / action；不提供新建按钮（Direct Create 属 F2-6B）。
 * PermissionGuard 对齐 API requirePermission("quotation:view")（三层一致铁律）。
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import type { StatusTone } from "@/components/design-system";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge, ConfirmActionDialog } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { useSession } from "@/lib/session-context";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatMoney } from "@/lib/format";

interface QuotationRow {
  id: string;
  code: string;
  status: string;
  effectiveStatus?: string;
  quoteDate: string;
  validUntil?: string | null;
  currency: string;
  totalAmount: string;
  customer?: { id: string; code: string | null; name: string | null } | null;
  _count?: { lines: number };
}

const STATUS_OPTIONS = ["DRAFT", "SUBMITTED", "APPROVED", "SENT", "ACCEPTED", "REJECTED", "CANCELLED", "CONVERTED"] as const;

/** 状态中文业务名（Business UX Rationalization：枚举展示中文，不展示数据库枚举值；key 保留真实 enum） */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "已提交",
  APPROVED: "已批准",
  SENT: "已发送",
  ACCEPTED: "客户已接受",
  REJECTED: "已拒绝",
  CANCELLED: "已取消",
  CONVERTED: "已转订单",
  EXPIRED: "已过期",
};

const TONE_MAP: Record<string, StatusTone> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  APPROVED: "success",
  SENT: "info",
  ACCEPTED: "success",
  REJECTED: "danger",
  CANCELLED: "danger",
  CONVERTED: "info",
  EXPIRED: "warning",
};

/** 可删除状态（回退管理：废弃终态清理列表） */
const DELETABLE_STATUSES = ["DRAFT", "REJECTED", "CANCELLED"] as const;

function QuotationList() {
  const router = useRouter();
  const toast = useToast();
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];
  const canCreate = hasPermission(roles, actionPermission("quotation", "create"));
  const canDelete = hasPermission(roles, actionPermission("quotation", "delete"));
  const [deleting, setDeleting] = useState<QuotationRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ code?: string; status?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<QuotationRow>("/api/quotations", filters);

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
      await apiFetch("/api/quotations/" + deleting.id, { method: "DELETE" });
      toast.success("报价单已删除");
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

  const isDeletable = (row: QuotationRow) =>
    canDelete && (DELETABLE_STATUSES as readonly string[]).includes(row.status);

  return (
    <AppPage>
      <EntityListWorkspace<QuotationRow>
        title="报价单"
        description="销售报价单列表"
        emptyMessage="暂无报价单——点击「+ 新建报价单」创建第一张报价单"
        headerActions={
          canCreate ? (
            <Link
              href="/sales/quotations/new"
              className={BUTTON_PRIMARY_CLASS}
            >
              + 新建报价单
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
                href={`/sales/quotations/${row.id}`}
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
                status={row.effectiveStatus ?? row.status}
                label={STATUS_LABELS[row.effectiveStatus ?? row.status] ?? row.effectiveStatus ?? row.status}
                toneMap={TONE_MAP}
              />
            ),
          },
          {
            key: "customer",
            header: "客户",
            render: (row) => row.customer?.name ?? "—",
          },
          {
            key: "quoteDate",
            header: "报价日期",
            render: (row) => formatDate(row.quoteDate),
          },
          {
            key: "validUntil",
            header: "有效期至",
            render: (row) => formatDate(row.validUntil),
          },
          {
            key: "totalAmount",
            header: "含税合计",
            align: "right",
            render: (row) => formatMoney(row.totalAmount, row.currency),
          },
          {
            key: "lines",
            header: "行数",
            render: (row) => String(row._count?.lines ?? 0),
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
        rowActions={(row) =>
          isDeletable(row) ? (
            <div className="flex justify-end gap-1">
              <button type="button" onClick={() => router.push("/sales/quotations/" + row.id)} className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-slate-100">
                详情
              </button>
              <button type="button" onClick={() => setDeleting(row)} className="rounded-md border border-status-danger-border px-2 py-1 text-xs text-status-danger-text transition-colors hover:bg-red-50">
                删除
              </button>
            </div>
          ) : undefined
        }
      />
      <ConfirmActionDialog
        open={deleting !== null}
        title={"删除报价单「" + (deleting?.code ?? "") + "」？"}
        description="仅草稿/已拒绝/已取消的报价单可删除（清理列表）；已提交/已生效/已转订单的报价单不可删除。"
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
    <PermissionGuard permission={actionPermission("quotation", "view")}>
      <QuotationList />
    </PermissionGuard>
  );
}