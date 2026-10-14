"use client";

/**
 * Items — 物料管理列表页（F2-2 Master Data Workspaces）
 *
 * 依据 Contract Card（items.md）：backend CRUD FINAL，本 Wave 实现 List。
 * 结构：AppPage + EntityListWorkspace（Header → Toolbar → Table → Pagination）。
 *
 * 列表字段整理（2026-09-27 用户指令「重新整理列表字段显示」）：列与表单字段一一对应且同序 ——
 * 编码 / 名称 / 系列 / 型号 / 规格 / 类型 / 分类 / 计量单位 / OEM 编码；
 * 移除 状态、可采购、可销售、创建时间 四列（「状态」仍保留为筛选条件，不丢能力）。
 * 「材料类型」与「分类」是两个独立控件（不联动），但保存后同源：材料类型文字会匹配/新建物料分类。
 * 列表「材料类型」列展示分类名，「分类」列展示分类树位置（categoryPath + 名称），两列各有信息、不重复。
 * 筛选：编码 / 名称 / 分类（原「类型」枚举筛选改为分类筛选，因为表单已不再写 itemType）。
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { actionPermission } from "@nilier-crm/shared";
import { can, useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, ReferenceErrorNote, ConfirmActionDialog } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery, readUrlFilterParams } from "@/lib/use-list-query";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useReferenceOptions, referenceErrorText } from "@/lib/use-reference-options";
import { useToast } from "@/components/ui/toast";

interface ItemRow {
  id: string;
  code: string;
  name: string;
  series: string | null;
  model: string | null;
  spec: string | null;
  oemCode: string | null;
  status: string | null;
  category?: { code: string | null; name: string | null; categoryPath?: string | null } | null;
  stockUom?: { code: string | null; name: string | null; symbol: string | null } | null;
}

interface CategoryOption {
  id: string;
  code: string | null;
  name: string | null;
  categoryPath?: string | null;
}

const STATUS_OPTIONS = ["ACTIVE", "INACTIVE", "LOCKED", "ARCHIVED"] as const;

/** 状态中文业务名（Business UX Rationalization：枚举展示中文，不展示数据库枚举值；key 保留真实 enum） */
const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "启用",
  INACTIVE: "停用",
  LOCKED: "锁定",
  ARCHIVED: "已归档",
};

/** 引用源对应的后端权限码（403 时明确"缺哪个权限"，便于管理员授权） */
const REF_CATEGORY_PERMISSION = "item-category:view";

/** 分类展示：分类树位置（categoryPath）+ 名称，如「001.003 机床直线导轨」 */
function formatCategoryPath(row: ItemRow): string {
  const name = row.category?.name ?? "";
  const path = row.category?.categoryPath ?? "";
  if (!name && !path) return "—";
  return path ? path + " " + name : name;
}

function ItemList() {
  const router = useRouter();
  const toast = useToast();
  const { state } = useSession();
  // ADR-0057：按会话有效权限集判定（DB 权威）
  const canCreate = can(state.user, actionPermission("item", "create"));
  const canEdit = can(state.user, actionPermission("item", "edit"));
  const canDelete = can(state.user, actionPermission("item", "delete"));
  const [deleting, setDeleting] = useState<ItemRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // 分类筛选数据源（每源独立取数：失败字段级可见 + 可单独重试）
  const categories = useReferenceOptions<CategoryOption>("/api/item-categories?pageSize=100");
  const categoryError = referenceErrorText(categories.error, REF_CATEGORY_PERMISSION);

  const [codeInput, setCodeInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [categoryInput, setCategoryInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{
    code?: string;
    name?: string;
    categoryId?: string;
    status?: string;
  }>({});

  const { items, total, page, pageSize, loading, error, setPage, setPageSize, refresh } =
    useListQuery<ItemRow>("/api/items", filters, 20, { syncUrl: true });

  // URL 筛选恢复（hydration 后一次性应用；刷新/分享后筛选不丢失）
  const urlRestored = useRef(false);
  useEffect(() => {
    if (urlRestored.current) return;
    urlRestored.current = true;
    const u = readUrlFilterParams(["code", "name", "categoryId", "status"]);
    setCodeInput(u.code ?? "");
    setNameInput(u.name ?? "");
    setCategoryInput(u.categoryId ?? "");
    setStatusInput(u.status ?? "");
    setFilters(() => {
      const n: { code?: string; name?: string; categoryId?: string; status?: string } = {};
      if (u.code) n.code = u.code;
      if (u.name) n.name = u.name;
      if (u.categoryId) n.categoryId = u.categoryId;
      if (u.status) n.status = u.status;
      return n;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilter = () => {
    const next: { code?: string; name?: string; categoryId?: string; status?: string } = {};
    if (codeInput.trim()) next.code = codeInput.trim();
    if (nameInput.trim()) next.name = nameInput.trim();
    if (categoryInput) next.categoryId = categoryInput;
    if (statusInput) next.status = statusInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setCodeInput("");
    setNameInput("");
    setCategoryInput("");
    setStatusInput("");
    setFilters({});
    setPage(1);
  };

  const categoryLabel = (id: string | undefined): string => {
    if (!id) return "";
    const c = categories.data.find((x) => x.id === id);
    return c?.name ?? id;
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
            <div className="flex flex-col gap-1">
              <select
                value={categoryInput}
                onChange={(e) => setCategoryInput(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">{categories.loading ? "分类加载中…" : "全部分类"}</option>
                {categories.data.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name ?? c.code ?? ""}
                  </option>
                ))}
              </select>
              {/* 分类筛选源独立取数：失败可见 + 可单独重试（不静默显示空列表） */}
              <ReferenceErrorNote message={categoryError} onRetry={categories.reload} />
            </div>
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
          { key: "series", header: "系列", render: (row) => row.series ?? "—" },
          { key: "model", header: "型号", render: (row) => row.model ?? "—" },
          { key: "spec", header: "规格", render: (row) => row.spec ?? "—" },
          {
            // 「材料类型」＝ 分类名（表单「材料类型」输入即匹配/新建物料分类）
            key: "categoryName",
            header: "材料类型",
            render: (row) => row.category?.name ?? "—",
          },
          {
            // 「分类」＝ 分类树位置（categoryPath + 名称），与「类型」列信息互补不重复
            key: "categoryPath",
            header: "分类",
            render: (row) => formatCategoryPath(row),
          },
          {
            key: "stockUom",
            header: "计量单位",
            render: (row) => row.stockUom?.symbol ?? row.stockUom?.name ?? "—",
          },
          { key: "oemCode", header: "OEM 编码", render: (row) => row.oemCode ?? "—" },
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
          filters.categoryId
            ? {
                key: "categoryId",
                label: `分类：${categoryLabel(filters.categoryId)}`,
                onClear: () => {
                  setCategoryInput("");
                  setFilters((prev) => {
                    const n = { ...prev };
                    delete n.categoryId;
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
              <button type="button" onClick={() => router.push(`/items/${row.id}/edit`)} className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-surface-hover">
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
