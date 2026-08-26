"use client";

/** Technical Standards — 技术标准列表页（Pending Pages Completion Gate — Batch 1） */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, ConfirmActionDialog } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";

interface TechnicalStandardRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

function TechnicalStandardList() {
  const router = useRouter();
  const toast = useToast();
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];
  const canCreate = hasPermission(roles, actionPermission("technical-standard", "create"));
  const canEdit = hasPermission(roles, actionPermission("technical-standard", "edit"));
  const canDelete = hasPermission(roles, actionPermission("technical-standard", "delete"));
  const [deleting, setDeleting] = useState<TechnicalStandardRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [codeInput, setCodeInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [filters, setFilters] = useState<{ code?: string; name?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<TechnicalStandardRow>("/api/technical-standards", filters);

  const applyFilter = () => {
    const next: { code?: string; name?: string } = {};
    if (codeInput.trim()) next.code = codeInput.trim();
    if (nameInput.trim()) next.name = nameInput.trim();
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setCodeInput("");
    setNameInput("");
    setFilters({});
    setPage(1);
  };

  const runDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await apiFetch("/api/technical-standards/" + deleting.id, { method: "DELETE" });
      toast.success("技术标准已删除");
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
      <EntityListWorkspace<TechnicalStandardRow>
        title="技术标准"
        description="维护行业/企业技术标准，供物料引用"
        emptyMessage="暂无技术标准"
        headerActions={
          canCreate ? (
            <Link
              href="/technical-standards/new"
              className={BUTTON_PRIMARY_CLASS}
            >
              + 新建技术标准
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
              <Link href={`/technical-standards/${row.id}/edit`} className="font-medium text-brand-600 hover:underline">
                {row.code}
              </Link>
            ),
          },
          { key: "name", header: "名称" },
          { key: "description", header: "描述", render: (row) => row.description ?? "—" },
          { key: "isActive", header: "启用", render: (row) => (row.isActive ? "是" : "否") },
          { key: "createdAt", header: "创建时间", render: (row) => formatDate(row.createdAt) },
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
          <div className="flex justify-end gap-1">
            {canEdit && (
              <button type="button" onClick={() => router.push("/technical-standards/" + row.id + "/edit")} className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-surface-hover">
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
        title={"删除技术标准「" + (deleting?.name ?? "") + "」？"}
        description="技术标准已被物料引用后不可删除（可编辑）；无引用将软删除并停用。"
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
    <PermissionGuard permission={actionPermission("technical-standard", "view")}>
      <TechnicalStandardList />
    </PermissionGuard>
  );
}