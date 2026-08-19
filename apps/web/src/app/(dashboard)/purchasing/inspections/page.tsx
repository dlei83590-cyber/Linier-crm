"use client";

/**
 * Inspections — 质检记录列表页（F2-3 Batch C1 Consolidation，CTO #11888）
 *
 * 由旧式自绘 table/filter 迁移至统一 Workspace：
 * AppPage → EntityListWorkspace → StatusBadge / ErrorPanel / common toolbar。
 * 保留「+ 新建质检」入口（如有）；不改 backend / 状态机 / action。
 */
import { useState } from "react";
import Link from "next/link";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";

interface InspectionRow {
  id: string;
  inspectionMode: string;
  result: string;
  qualifiedQty: string;
  rejectedQty: string;
  createdAt: string;
  inspectedBy?: { name: string | null } | null;
  purchaseReceiptLine?: {
    lineNo: number;
    purchaseReceipt?: { code: string | null } | null;
    item?: { code: string | null; name: string | null } | null;
    uom?: { symbol: string | null } | null;
  } | null;
}

const MODE_OPTIONS = ["SKIP", "SPOT", "FULL"] as const;

function InspectionList() {
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("inspection", "create"));
  const [modeInput, setModeInput] = useState("");
  const [resultInput, setResultInput] = useState("");
  const [filters, setFilters] = useState<{ inspectionMode?: string; result?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<InspectionRow>("/api/inspections", filters);

  const applyFilter = () => {
    const next: { inspectionMode?: string; result?: string } = {};
    if (modeInput) next.inspectionMode = modeInput;
    if (resultInput) next.result = resultInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setModeInput("");
    setResultInput("");
    setFilters({});
    setPage(1);
  };

  return (
    <AppPage>
      <EntityListWorkspace<InspectionRow>
        title="质检记录"
        description="质检记录工作台"
        headerActions={
          canCreate ? (
            <Link
              href="/purchasing/inspections/new"
              className={BUTTON_PRIMARY_CLASS}
            >
              + 新建质检
            </Link>
          ) : undefined
        }
        filters={
          <>
            <select
              value={modeInput}
              onChange={(e) => setModeInput(e.target.value)}
              className="rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            >
              <option value="">全部模式</option>
              {MODE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <select
              value={resultInput}
              onChange={(e) => setResultInput(e.target.value)}
              className="rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            >
              <option value="">全部结果</option>
              <option value="QUALIFIED">合格</option>
              <option value="PARTIAL">部分合格</option>
              <option value="REJECTED">拒收</option>
              <option value="PENDING">待检</option>
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
            key: "receipt",
            header: "收货单",
            render: (row) => (
              <Link
                href={`/purchasing/inspections/${row.id}`}
                className="font-medium text-brand-600 hover:underline"
              >
                {row.purchaseReceiptLine?.purchaseReceipt?.code ?? "—"}
              </Link>
            ),
          },
          {
            key: "lineNo",
            header: "行号",
            render: (row) => String(row.purchaseReceiptLine?.lineNo ?? "—"),
          },
          {
            key: "item",
            header: "物料",
            render: (row) =>
              row.purchaseReceiptLine?.item
                ? `${row.purchaseReceiptLine.item.code ?? ""} ${row.purchaseReceiptLine.item.name ?? ""}`.trim()
                : "—",
          },
          { key: "inspectionMode", header: "质检模式", render: (row) => row.inspectionMode },
          {
            key: "result",
            header: "结果",
            render: (row) => <StatusBadge status={row.result} />,
          },
          { key: "qualifiedQty", header: "合格数量", render: (row) => row.qualifiedQty },
          { key: "rejectedQty", header: "拒收数量", render: (row) => row.rejectedQty },
          {
            key: "inspectedBy",
            header: "质检人",
            render: (row) => row.inspectedBy?.name ?? "—",
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
    <PermissionGuard permission={PERMISSIONS.INSPECTION_READ}>
      <InspectionList />
    </PermissionGuard>
  );
}