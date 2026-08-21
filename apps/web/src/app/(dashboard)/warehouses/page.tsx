"use client";

/**
 * Warehouses — 仓库列表页（Master Data CRUD）
 *
 * 新建/编辑/删除（删除规则：被库位或业务单据引用 → 409 不可删但可编辑）。
 * 关联体验：每行提供「查看库位」入口 → /warehouse-locations?warehouseId={id}。
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PERMISSIONS, actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import { AppPage, EntityListWorkspace, ConfirmActionDialog } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { useSession } from "@/lib/session-context";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";


interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  type: string | null;
  address: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
}

function WarehouseList() {
  const router = useRouter();
  const toast = useToast();
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];
  const canCreate = hasPermission(roles, actionPermission("warehouse", "create"));
  const canEdit = hasPermission(roles, actionPermission("warehouse", "edit"));
  const canDelete = hasPermission(roles, actionPermission("warehouse", "delete"));
  const [codeInput, setCodeInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [typeInput, setTypeInput] = useState("");
  const [activeInput, setActiveInput] = useState("");
  const [filters, setFilters] = useState<{ code?: string; name?: string; type?: string; isActive?: string }>({});
  const [deleting, setDeleting] = useState<WarehouseRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<WarehouseRow>("/api/warehouses", filters);

  const applyFilter = () => {
    const next: { code?: string; name?: string; type?: string; isActive?: string } = {};
    if (codeInput.trim()) next.code = codeInput.trim();
    if (nameInput.trim()) next.name = nameInput.trim();
    if (typeInput.trim()) next.type = typeInput.trim();
    if (activeInput) next.isActive = activeInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setCodeInput("");
    setNameInput("");
    setTypeInput("");
    setActiveInput("");
    setFilters({});
    setPage(1);
  };

  const runDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await apiFetch(`/api/warehouses/${deleting.id}`, { method: "DELETE" });
      toast.success("仓库已删除");
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
      <EntityListWorkspace<WarehouseRow>
        title="仓库"
        description="仓库主数据（被业务单据引用后不可删除，但可编辑）"
        emptyMessage="暂无仓库"
        headerActions={
          canCreate ? (
            <button type="button" onClick={() => router.push("/warehouses/new")} className={BUTTON_PRIMARY_CLASS}>
              新建仓库
            </button>
          ) : null
        }
        filters={
          <>
            <input value={codeInput} onChange={(e) => setCodeInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") applyFilter(); }} placeholder="按编码搜索" className={"w-40 " + SELECT_CLASS} />
            <input value={nameInput} onChange={(e) => setNameInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") applyFilter(); }} placeholder="按名称搜索" className={"w-40 " + SELECT_CLASS} />
            <input value={typeInput} onChange={(e) => setTypeInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") applyFilter(); }} placeholder="按类型搜索" className={"w-32 " + SELECT_CLASS} />
            <select value={activeInput} onChange={(e) => setActiveInput(e.target.value)} className={SELECT_CLASS}>
              <option value="">全部状态</option>
              <option value="true">启用</option>
              <option value="false">停用</option>
            </select>
          </>
        }
        toolbarActions={
          <>
            <button type="button" onClick={applyFilter} className={BUTTON_PRIMARY_CLASS}>查询</button>
            <button type="button" onClick={resetFilter} className={BUTTON_SECONDARY_CLASS}>重置</button>
          </>
        }
        columns={[
          { key: "code", header: "编码", render: (row) => (<Link href={`/warehouse-locations?warehouseId=${row.id}`} className="font-medium text-brand-600 hover:underline">{row.code}</Link>) },
          { key: "name", header: "名称" },
          { key: "type", header: "类型", render: (row) => row.type ?? "—" },
          { key: "address", header: "地址", render: (row) => row.address ?? "—" },
          { key: "isActive", header: "启用", render: (row) => (row.isActive ? "是" : "否") },
          {
            key: "locations",
            header: "库位",
            render: (row) => (
              <Link href={`/warehouse-locations?warehouseId=${row.id}`} className="text-sm text-brand-600 hover:underline">
                查看库位 →
              </Link>
            ),
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
        rowActions={
          (row) => (
            <div className="flex justify-end gap-1">
              {canEdit && (
                <button type="button" onClick={() => router.push(`/warehouses/${row.id}/edit`)} className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-slate-100">
                  编辑
                </button>
              )}
              {canDelete && (
                <button type="button" onClick={() => setDeleting(row)} className="rounded-md border border-status-danger-border px-2 py-1 text-xs text-status-danger-text transition-colors hover:bg-red-50">
                  删除
                </button>
              )}
            </div>
          )
        }
      />
      <ConfirmActionDialog
        open={deleting !== null}
        title={`删除仓库「${deleting?.name ?? ""}」？`}
        description="被库位或业务单据引用后不可删除（可编辑）；无引用将软删除并停用。"
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
    <PermissionGuard permission={PERMISSIONS.WAREHOUSE_READ}>
      <WarehouseList />
    </PermissionGuard>
  );
}
