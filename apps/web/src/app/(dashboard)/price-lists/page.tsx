"use client";

/**
 * Price Lists — 价格表列表页（F2-2 Master Data Workspaces）
 *
 * 依据 Contract Card（price-lists.md）：backend CRUD FINAL → 本 Wave 实现 List。
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

interface PriceListRow {
  id: string;
  code: string;
  name: string;
  priceType: string | null;
  status: string | null;
  currency: string | null;
  policy?: { code: string | null; name: string | null } | null;
  _count?: { items: number };
  createdAt: string;
}

const PRICE_TYPE_OPTIONS = [
  "PURCHASE",
  "SALES",
  "VIP",
  "AGENT",
  "ENGINEERING",
  "STRATEGIC",
  "REGIONAL",
  "CUSTOMER",
  "HISTORICAL",
] as const;

const STATUS_OPTIONS = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;

/** 状态中文业务名（Business UX Rationalization：枚举展示中文，不展示数据库枚举值；key 保留真实 enum） */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  PUBLISHED: "已发布",
  ARCHIVED: "已归档",
};

const PRICE_TYPE_LABELS: Record<string, string> = {
  PURCHASE: "采购",
  SALES: "销售",
  VIP: "VIP",
  AGENT: "代理",
  ENGINEERING: "工程",
  STRATEGIC: "战略",
  REGIONAL: "区域",
  CUSTOMER: "客户",
  HISTORICAL: "历史",
};

const STATUS_TONE_MAP: Record<string, "neutral" | "success" | "danger"> = {
  DRAFT: "neutral",
  PUBLISHED: "success",
  ARCHIVED: "danger",
};

function PriceListPage() {
  const router = useRouter();
  const toast = useToast();
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];
  const canCreate = hasPermission(roles, actionPermission("price-list", "create"));
  const canEdit = hasPermission(roles, actionPermission("price-list", "edit"));
  const canDelete = hasPermission(roles, actionPermission("price-list", "delete"));
  const [deleting, setDeleting] = useState<PriceListRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [codeInput, setCodeInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [typeInput, setTypeInput] = useState("");
  const [filters, setFilters] = useState<{
    code?: string;
    name?: string;
    status?: string;
    priceType?: string;
  }>({});

  const { items, total, page, pageSize, loading, error, setPage, setPageSize, refresh } =
    useListQuery<PriceListRow>("/api/price-lists", filters, 20, { syncUrl: true });

  // URL 筛选恢复（hydration 后一次性应用；刷新/分享后筛选不丢失）
  const urlRestored = useRef(false);
  useEffect(() => {
    if (urlRestored.current) return;
    urlRestored.current = true;
    const u = readUrlFilterParams(["code", "name", "status", "priceType"]);
    setCodeInput(u.code ?? "");
    setNameInput(u.name ?? "");
    setStatusInput(u.status ?? "");
    setTypeInput(u.priceType ?? "");
    setFilters(() => {
      const n: { code?: string; name?: string; status?: string; priceType?: string } = {};
      if (u.code) n.code = u.code;
      if (u.name) n.name = u.name;
      if (u.status) n.status = u.status;
      if (u.priceType) n.priceType = u.priceType;
      return n;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilter = () => {
    const next: { code?: string; name?: string; status?: string; priceType?: string } = {};
    if (codeInput.trim()) next.code = codeInput.trim();
    if (nameInput.trim()) next.name = nameInput.trim();
    if (statusInput) next.status = statusInput;
    if (typeInput) next.priceType = typeInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setCodeInput("");
    setNameInput("");
    setStatusInput("");
    setTypeInput("");
    setFilters({});
    setPage(1);
  };

  const runDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await apiFetch("/api/price-lists/" + deleting.id, { method: "DELETE" });
      toast.success("价格表已删除");
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
      <EntityListWorkspace<PriceListRow>
        title="价格表"
        description="统一价格主数据（采购/销售/VIP/代理/工程/战略等价格类型）"
        emptyMessage="暂无价格表——点击「+ 新建价格表」创建第一张价格表"
        headerActions={
          canCreate ? (
            <Link
              href="/price-lists/new"
              className={BUTTON_PRIMARY_CLASS}
            >
              + 新建价格表
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
            <select
              value={typeInput}
              onChange={(e) => setTypeInput(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">全部类型</option>
              {PRICE_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {PRICE_TYPE_LABELS[t]}
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
              <Link
                href={`/price-lists/${row.id}`}
                className="font-medium text-brand-600 hover:underline"
              >
                {row.code}
              </Link>
            ),
          },
          { key: "name", header: "名称" },
          {
            key: "priceType",
            header: "类型",
            render: (row) => (row.priceType ? PRICE_TYPE_LABELS[row.priceType] ?? row.priceType : "—"),
          },
          {
            key: "status",
            header: "状态",
            render: (row) =>
              row.status ? <StatusBadge status={row.status} label={STATUS_LABELS[row.status] ?? row.status} toneMap={STATUS_TONE_MAP} /> : "—",
          },
          {
            key: "policy",
            header: "价格策略",
            render: (row) => row.policy?.name ?? "—",
          },
          // 单币种 CNY：币种列移除（消除多币种残留）
          {
            key: "items",
            header: "条目数",
            render: (row) => String(row._count?.items ?? 0),
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
          filters.code ? { key: "code", label: `编码：${filters.code}`, onClear: () => { setCodeInput(""); setFilters((prev) => { const n = { ...prev }; delete n.code; return n; }); } } : null,
          filters.name ? { key: "name", label: `名称：${filters.name}`, onClear: () => { setNameInput(""); setFilters((prev) => { const n = { ...prev }; delete n.name; return n; }); } } : null,
          filters.status ? { key: "status", label: `状态：${STATUS_LABELS[filters.status] ?? filters.status}`, onClear: () => { setStatusInput(""); setFilters((prev) => { const n = { ...prev }; delete n.status; return n; }); } } : null,
          filters.priceType ? { key: "priceType", label: `类型：${PRICE_TYPE_LABELS[filters.priceType] ?? filters.priceType}`, onClear: () => { setTypeInput(""); setFilters((prev) => { const n = { ...prev }; delete n.priceType; return n; }); } } : null,
        ].filter((c): c is NonNullable<typeof c> => c !== null)}
        rowActions={(row) => (
          <div className="flex justify-end gap-1">
            {canEdit && (
              <button type="button" onClick={() => router.push("/price-lists/" + row.id + "/edit")} className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-surface-hover">
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
        title={"删除价格表「" + (deleting?.name ?? "") + "」？"}
        description="价格表已配置单价/版本或被报价单引用后不可删除（可编辑）；无引用将软删除并停用。"
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
    <PermissionGuard permission={actionPermission("price-list", "view")}>
      <PriceListPage />
    </PermissionGuard>
  );
}