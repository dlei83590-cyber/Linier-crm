"use client";

/**
 * Items — 物料管理列表页（F2-2 Master Data Workspaces）
 *
 * 依据 Contract Card（items.md）：backend CRUD FINAL，本 Wave 实现 List。
 * 结构：AppPage + EntityListWorkspace（Header → Toolbar → Table → Pagination）。
 */
import { useState } from "react";
import Link from "next/link";
import { hasPermission, PERMISSIONS, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";

interface ItemRow {
  id: string;
  code: string;
  name: string;
  itemType: string | null;
  status: string | null;
  category?: { code: string | null; name: string | null } | null;
  stockUom?: { code: string | null; symbol: string | null } | null;
  isSalable: boolean | null;
  isPurchasable: boolean | null;
  createdAt: string;
}

const ITEM_TYPE_OPTIONS = [
  "FINISHED_GOOD",
  "RAW_MATERIAL",
  "SEMI_FINISHED",
  "PURCHASED_PART",
  "ACCESSORY",
  "SERVICE",
  "CONSUMABLE",
  "ASSET",
  "TOOLING",
  "PACKAGING",
] as const;

const STATUS_OPTIONS = ["ACTIVE", "INACTIVE", "LOCKED", "ARCHIVED"] as const;

const ITEM_TYPE_LABELS: Record<string, string> = {
  FINISHED_GOOD: "成品",
  RAW_MATERIAL: "原材料",
  SEMI_FINISHED: "半成品",
  PURCHASED_PART: "外购件",
  ACCESSORY: "配件",
  SERVICE: "服务",
  CONSUMABLE: "消耗品",
  ASSET: "资产",
  TOOLING: "工装",
  PACKAGING: "包装物",
};

const ITEM_TONE_MAP: Record<string, "success" | "neutral" | "warning" | "danger"> = {
  ACTIVE: "success",
  INACTIVE: "neutral",
  LOCKED: "warning",
  ARCHIVED: "danger",
};

function ItemList() {
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], "item:create");

  const [codeInput, setCodeInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [typeInput, setTypeInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{
    code?: string;
    name?: string;
    itemType?: string;
    status?: string;
  }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<ItemRow>("/api/items", filters);

  const applyFilter = () => {
    const next: { code?: string; name?: string; itemType?: string; status?: string } = {};
    if (codeInput.trim()) next.code = codeInput.trim();
    if (nameInput.trim()) next.name = nameInput.trim();
    if (typeInput) next.itemType = typeInput;
    if (statusInput) next.status = statusInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setCodeInput("");
    setNameInput("");
    setTypeInput("");
    setStatusInput("");
    setFilters({});
    setPage(1);
  };

  return (
    <AppPage>
      <EntityListWorkspace<ItemRow>
        title="物料管理"
        description="统一物料主数据（成品/原材料/配件/外购件/服务/包装物）"
        headerActions={
          canCreate ? (
            <Link
              href="/items/new"
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              + 新建物料
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
              placeholder="按编码搜索"
              className="w-40 rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            />
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按名称搜索"
              className="w-40 rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            />
            <select
              value={typeInput}
              onChange={(e) => setTypeInput(e.target.value)}
              className="rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            >
              <option value="">全部类型</option>
              {ITEM_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {ITEM_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
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
            header: "编码",
            render: (row) => (
              <Link href={`/items/${row.id}`} className="font-medium text-brand-600 hover:underline">
                {row.code}
              </Link>
            ),
          },
          { key: "name", header: "名称" },
          {
            key: "itemType",
            header: "类型",
            render: (row) => (row.itemType ? ITEM_TYPE_LABELS[row.itemType] ?? row.itemType : "—"),
          },
          {
            key: "status",
            header: "状态",
            render: (row) =>
              row.status ? (
                <StatusBadge status={row.status} toneMap={ITEM_TONE_MAP} />
              ) : (
                "—"
              ),
          },
          {
            key: "category",
            header: "分类",
            render: (row) => row.category?.name ?? "—",
          },
          {
            key: "stockUom",
            header: "库存单位",
            render: (row) => row.stockUom?.symbol ?? "—",
          },
          {
            key: "isPurchasable",
            header: "可采购",
            render: (row) => (row.isPurchasable ? "是" : "否"),
          },
          {
            key: "isSalable",
            header: "可销售",
            render: (row) => (row.isSalable ? "是" : "否"),
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
    <PermissionGuard permission={PERMISSIONS.ITEM_READ}>
      <ItemList />
    </PermissionGuard>
  );
}
