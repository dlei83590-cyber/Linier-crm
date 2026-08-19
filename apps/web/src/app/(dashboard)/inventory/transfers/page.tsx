"use client";

/**
 * Inventory Transfers — 库存调拨列表页（F2-3 Batch C2 Consolidation，CTO #11888）
 *
 * 由旧式自绘 table/filter 迁移至统一 Workspace：
 * AppPage → EntityListWorkspace → StatusBadge / ErrorPanel / common toolbar。
 * 不改 backend / 状态机 / action；useListQuery + filters 原样保留。
 */
import { useState } from "react";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";

interface TransferRow {
  id: string;
  transferNo: string;
  status: string;
  createdAt: string;
  sourceWarehouse?: { name: string | null } | null;
  destinationWarehouse?: { name: string | null } | null;
  _count?: { lines: number };
}

const STATUS_OPTIONS = ["DRAFT", "SUBMITTED", "APPROVED", "EXECUTED", "CANCELLED"] as const;

function TransferList() {
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("inventory-transfer", "create"));
  const [noInput, setNoInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ transferNo?: string; status?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<TransferRow>("/api/inventory-transfers", filters);

  const applyFilter = () => {
    const next: { transferNo?: string; status?: string } = {};
    if (noInput.trim()) next.transferNo = noInput.trim();
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

  return (
    <AppPage>
      <EntityListWorkspace<TransferRow>
        title="库存调拨"
        description="库存调拨工作台"
        headerActions={
          canCreate ? (
            <Link
              href="/inventory/transfers/new"
              className={BUTTON_PRIMARY_CLASS}
            >
              + 新建调拨
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
              placeholder="按调拨单号搜索"
              className="w-40 rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            />
            <select
              value={statusInput}
              onChange={(e) => setStatusInput(e.target.value)}
              className="rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            >
              <option value="">全部状态</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
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
            key: "transferNo",
            header: "调拨单号",
            render: (row) => (
              <Link
                href={`/inventory/transfers/${row.id}`}
                className="font-medium text-brand-600 hover:underline"
              >
                {row.transferNo}
              </Link>
            ),
          },
          {
            key: "status",
            header: "状态",
            render: (row) => <StatusBadge status={row.status} />,
          },
          {
            key: "sourceWarehouse",
            header: "源仓库",
            render: (row) => row.sourceWarehouse?.name ?? "—",
          },
          {
            key: "destinationWarehouse",
            header: "目标仓库",
            render: (row) => row.destinationWarehouse?.name ?? "—",
          },
          {
            key: "lines",
            header: "行数",
            render: (row) => String(row._count?.lines ?? 0),
          },
          {
            key: "createdAt",
            header: "创建时间",
            render: (row) => formatDate(row.createdAt),
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
      />
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.INVENTORY_TRANSFER_READ}>
      <TransferList />
    </PermissionGuard>
  );
}