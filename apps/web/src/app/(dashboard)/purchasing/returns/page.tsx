"use client";

/**
 * Purchase Returns — 采购退货列表页（F2-3 Batch C1 Consolidation，CTO #11888）
 *
 * 由旧式自绘 table/filter 迁移至统一 Workspace：
 * AppPage → EntityListWorkspace → StatusBadge / ErrorPanel / common toolbar。
 * 保留「+ 新建退货」入口（如有）；不改 backend / 状态机 / action。
 */
import { useState } from "react";
import Link from "next/link";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";

interface ReturnRow {
  id: string;
  code: string;
  status: string;
  createdAt: string;
  purchaseOrder?: { code: string | null } | null;
  supplier?: { name: string | null } | null;
  _count?: { lines: number };
}

const STATUS_OPTIONS = ["DRAFT", "RETURNED", "CANCELLED"] as const;

function ReturnList() {
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("purchase-return", "create"));
  const [codeInput, setCodeInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ code?: string; status?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<ReturnRow>("/api/purchase-returns", filters);

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

  return (
    <AppPage>
      <EntityListWorkspace<ReturnRow>
        title="采购退货"
        description="采购退货工作台"
        headerActions={
          canCreate ? (
            <Link
              href="/purchasing/returns/new"
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              + 新建退货单
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
              placeholder="按退货单号搜索"
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
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              查询
            </button>
            <button
              type="button"
              onClick={resetFilter}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-slate-50"
            >
              重置
            </button>
          </>
        }
        columns={[
          {
            key: "code",
            header: "退货单号",
            render: (row) => (
              <Link
                href={`/purchasing/returns/${row.id}`}
                className="font-medium text-brand-600 hover:underline"
              >
                {row.code}
              </Link>
            ),
          },
          {
            key: "status",
            header: "状态",
            render: (row) => <StatusBadge status={row.status} />,
          },
          {
            key: "purchaseOrder",
            header: "采购订单",
            render: (row) => row.purchaseOrder?.code ?? "—",
          },
          {
            key: "supplier",
            header: "供应商",
            render: (row) => row.supplier?.name ?? "—",
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
    <PermissionGuard permission={PERMISSIONS.PURCHASE_RETURN_READ}>
      <ReturnList />
    </PermissionGuard>
  );
}
