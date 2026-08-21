"use client";

/**
 * Unit of Measures — 计量单位列表页（Master-Data CRUD：列表 + 新建/编辑/删除行操作）
 *
 * 删除遵循「有应用不可删除（可编辑）」：被物料/单据行/换算引用 → 后端 409，前端 toast 提示。
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge, ConfirmActionDialog } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";

interface UomRow {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  isActive: boolean;
  approvalStatus: string | null;
  createdAt: string;
}

const APPROVAL_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "已提交",
  APPROVED: "已批准",
  REJECTED: "已拒绝",
};

const APPROVAL_TONE_MAP: Record<string, "neutral" | "info" | "success" | "danger"> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  APPROVED: "success",
  REJECTED: "danger",
};

function UomList() {
  const router = useRouter();
  const toast = useToast();
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];
  const canCreate = hasPermission(roles, actionPermission("unit-of-measure", "create"));
  const canEdit = hasPermission(roles, actionPermission("unit-of-measure", "edit"));
  const canDelete = hasPermission(roles, actionPermission("unit-of-measure", "delete"));
  const [deleting, setDeleting] = useState<UomRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [codeInput, setCodeInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [activeInput, setActiveInput] = useState("");
  const [filters, setFilters] = useState<{ code?: string; name?: string; isActive?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<UomRow>("/api/unit-of-measures", filters);

  const applyFilter = () => {
    const next: { code?: string; name?: string; isActive?: string } = {};
    if (codeInput.trim()) next.code = codeInput.trim();
    if (nameInput.trim()) next.name = nameInput.trim();
    if (activeInput) next.isActive = activeInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setCodeInput("");
    setNameInput("");
    setActiveInput("");
    setFilters({});
    setPage(1);
  };

  const runDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await apiFetch("/api/unit-of-measures/" + deleting.id, { method: "DELETE" });
      toast.success("计量单位已删除");
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
      <EntityListWorkspace<UomRow>
        title="计量单位"
        description="计量单位主数据（件/套/米/公斤…）——列表支持新建/编辑/删除"
        emptyMessage="暂无计量单位——点击「+ 新建计量单位」创建第一个单位"
        headerActions={
          canCreate ? (
            <Link href="/unit-of-measures/new" className={BUTTON_PRIMARY_CLASS}>
              + 新建计量单位
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
              value={activeInput}
              onChange={(e) => setActiveInput(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">全部状态</option>
              <option value="true">启用</option>
              <option value="false">停用</option>
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
              <Link href={"/unit-of-measures/" + row.id + "/edit"} className="font-medium text-brand-600 hover:underline">
                {row.code}
              </Link>
            ),
          },
          { key: "name", header: "名称" },
          { key: "symbol", header: "符号", render: (row) => row.symbol ?? "—" },
          {
            key: "approvalStatus",
            header: "审批状态",
            render: (row) =>
              row.approvalStatus ? (
                <StatusBadge
                  status={row.approvalStatus}
                  label={APPROVAL_LABELS[row.approvalStatus] ?? row.approvalStatus}
                  toneMap={APPROVAL_TONE_MAP}
                />
              ) : (
                "—"
              ),
          },
          {
            key: "isActive",
            header: "启用",
            render: (row) => (row.isActive ? "是" : "否"),
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
        rowActions={(row) => (
          <div className="flex justify-end gap-1">
            {canEdit && (
              <button type="button" onClick={() => router.push("/unit-of-measures/" + row.id + "/edit")} className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-slate-100">
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
        title={"删除计量单位「" + (deleting?.name ?? "") + "」？"}
        description="计量单位已被物料/单据/换算引用后不可删除（可编辑）；无引用将软删除并停用。"
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
    <PermissionGuard permission={actionPermission("unit-of-measure", "view")}>
      <UomList />
    </PermissionGuard>
  );
}
