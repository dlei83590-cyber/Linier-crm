"use client";

/**
 * Items — 物料管理列表页（F2-2 Master Data Workspaces）
 *
 * 依据 Contract Card（items.md）：backend CRUD FINAL，本 Wave 实现 List。
 * 结构：AppPage + EntityListWorkspace（Header → Toolbar → Table → Pagination）。
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge, ConfirmActionDialog } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery, readUrlFilterParams } from "@/lib/use-list-query";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
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

/** 状态中文业务名（Business UX Rationalization：枚举展示中文，不展示数据库枚举值；key 保留真实 enum） */
const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "启用",
  INACTIVE: "停用",
  LOCKED: "锁定",
  ARCHIVED: "已归档",
};

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
  const router = useRouter();
  const toast = useToast();
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];
  const canCreate = hasPermission(roles, actionPermission("item", "create"));
  const canEdit = hasPermission(roles, actionPermission("item", "edit"));
  const canDelete = hasPermission(roles, actionPermission("item", "delete"));
  const [deleting, setDeleting] = useState<ItemRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

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

  const { items, total, page, pageSize, loading, error, setPage, setPageSize, refresh } =
    useListQuery<ItemRow>("/api/items", filters, 20, { syncUrl: true });

  // URL 筛选恢复（hydration 后一次性应用；刷新/分享后筛选不丢失）
  const urlRestored = useRef(false);
  useEffect(() => {
    if (urlRestored.current) return;
    urlRestored.current = true;
    const u = readUrlFilterParams(["code", "name", "itemType", "status"]);
    setCodeInput(u.code ?? "");
    setNameInput(u.name ?? "");
    setTypeInput(u.itemType ?? "");
    setStatusInput(u.status ?? "");
    setFilters(() => {
      const n: { code?: string; name?: string; itemType?: string; status?: string } = {};
      if (u.code) n.code = u.code;
      if (u.name) n.name = u.name;
      if (u.itemType) n.itemType = u.itemType;
      if (u.status) n.status = u.status;
      return n;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const runDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await apiFetch(`/api/items/${deleting.id}`, { method: "DELETE" });
      toast.success("物料已删除");
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
      <EntityListWorkspace<ItemRow>
        title="物料管理"
        description="统一物料主数据（成品/原材料/配件/外购件/服务/包装物）"
        emptyMessage="暂无物料——点击「+ 新建物料」创建第一个物料"
        headerActions={
          canCreate ? (
            <Link
              href="/items/new"
              className={BUTTON_PRIMARY_CLASS}
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
              className={"w-40 " + SELECT_CLASS}
            />
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按名称搜索"
              className={"w-40 " + SELECT_CLASS}
            />
            <select
              value={typeInput}
              onChange={(e) => setTypeInput(e.target.value)}
              className={SELECT_CLASS}
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
                <StatusBadge status={row.status} label={STATUS_LABELS[row.status] ?? row.status} toneMap={ITEM_TONE_MAP} />
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
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        activeFilters={[
          filters.code
            ? {
                key: "code",
                label: `编码：${filters.code}`,
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
          filters.name
            ? {
                key: "name",
                label: `名称：${filters.name}`,
                onClear: () => {
                  setNameInput("");
                  setFilters((prev) => {
                    const n = { ...prev };
                    delete n.name;
                    return n;
                  });
                },
              }
            : null,
          filters.itemType
            ? {
                key: "itemType",
                label: `类型：${ITEM_TYPE_LABELS[filters.itemType] ?? filters.itemType}`,
                onClear: () => {
                  setTypeInput("");
                  setFilters((prev) => {
                    const n = { ...prev };
                    delete n.itemType;
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
        rowActions={(row) => (
          <div className="flex justify-end gap-1">
            {canEdit && (
              <button type="button" onClick={() => router.push(`/items/${row.id}/edit`)} className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-slate-100">
                编辑
              </button>
            )}
            {canDelete && (
              <button type="button" onClick={() => setDeleting(row)} className="rounded-md border border-status-danger-border px-2 py-1 text-xs text-status-danger-text transition-colors hover:bg-red-50">
                删除
              </button>
            )}
          </div>
        )}
      />
      <ConfirmActionDialog
        open={deleting !== null}
        title={`删除物料「${deleting?.name ?? ""}」？`}
        description="物料已被价格表/项目/单据引用后不可删除（可编辑）；无引用将软删除并停用。"
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
    <PermissionGuard permission={actionPermission("item", "view")}>
      <ItemList />
    </PermissionGuard>
  );
}