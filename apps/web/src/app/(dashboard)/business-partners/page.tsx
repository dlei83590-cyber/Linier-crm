"use client";

/**
 * Business Partners — 往来单位列表页（Pending Pages Completion Gate — Batch 1）
 *
 * 统一往来单位主数据：客户/供应商/客户兼供应商。
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge, ConfirmActionDialog } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { BUSINESS_PARTNER_CHANNELS, CHANNEL_UNSET_LABEL } from "@/lib/business-partner/channel";
import { useListQuery } from "@/lib/use-list-query";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";

interface BusinessPartnerRow {
  id: string;
  code: string;
  name: string;
  mnemonic: string | null;
  type: string;
  region: string | null;
  industry: string | null;
  channel: string | null;
  uscc: string | null;
  isActive: boolean;
  approvalStatus: string;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  CUSTOMER: "客户",
  SUPPLIER: "供应商",
  BOTH: "客户兼供应商",
};

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

function BusinessPartnerList() {
  const router = useRouter();
  const toast = useToast();
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];
  const canCreate = hasPermission(roles, actionPermission("business-partner", "create"));
  const canEdit = hasPermission(roles, actionPermission("business-partner", "edit"));
  const canDelete = hasPermission(roles, actionPermission("business-partner", "delete"));
  const [deleting, setDeleting] = useState<BusinessPartnerRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [codeInput, setCodeInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [typeInput, setTypeInput] = useState("");
  const [regionInput, setRegionInput] = useState("");
  const [channelInput, setChannelInput] = useState("");
  const [filters, setFilters] = useState<{ code?: string; name?: string; type?: string; region?: string; channel?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<BusinessPartnerRow>("/api/business-partners", filters);

  const applyFilter = () => {
    const next: { code?: string; name?: string; type?: string; region?: string; channel?: string } = {};
    if (codeInput.trim()) next.code = codeInput.trim();
    if (nameInput.trim()) next.name = nameInput.trim();
    if (typeInput) next.type = typeInput;
    if (regionInput.trim()) next.region = regionInput.trim();
    if (channelInput) next.channel = channelInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setCodeInput("");
    setNameInput("");
    setTypeInput("");
    setRegionInput("");
    setChannelInput("");
    setFilters({});
    setPage(1);
  };

  const runDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await apiFetch(`/api/business-partners/${deleting.id}`, { method: "DELETE" });
      toast.success("往来单位已删除");
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
      <EntityListWorkspace<BusinessPartnerRow>
        title="往来单位"
        description="客户/供应商/客户兼供应商统一管理，含统一社会信用代码、开票与结算信息"
        emptyMessage="暂无往来单位——点击「+ 新建往来单位」创建第一个客户/供应商"
        headerActions={
          canCreate ? (
            <Link
              href="/business-partners/new"
              className={BUTTON_PRIMARY_CLASS}
            >
              + 新建往来单位
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
              <option value="CUSTOMER">客户</option>
              <option value="SUPPLIER">供应商</option>
              <option value="BOTH">客户兼供应商</option>
            </select>
            <input
              value={regionInput}
              onChange={(e) => setRegionInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按区域搜索"
              className={"w-32 " + SELECT_CLASS}
            />
            <select value={channelInput} onChange={(e) => setChannelInput(e.target.value)} className={SELECT_CLASS}>
              <option value="">全部渠道</option>
              {BUSINESS_PARTNER_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value={CHANNEL_UNSET_LABEL}>{CHANNEL_UNSET_LABEL}</option>
            </select>
          </>
        }
        toolbarActions={
          <>
            <button
              type="button"
              onClick={applyFilter}
              className={BUTTON_SECONDARY_CLASS}
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
              <Link href={`/business-partners/${row.id}`} className="font-medium text-brand-600 hover:underline">
                {row.code}
              </Link>
            ),
          },
          { key: "name", header: "名称" },
          { key: "mnemonic", header: "助记码", render: (row) => row.mnemonic ?? "—" },
          {
            key: "type",
            header: "类型",
            render: (row) => (
              <span className="inline-flex items-center rounded-full bg-canvas px-2 py-0.5 text-xs font-medium text-ink-secondary">
                {TYPE_LABELS[row.type] ?? row.type}
              </span>
            ),
          },
          { key: "region", header: "区域", render: (row) => row.region ?? "—" },
          { key: "industry", header: "行业", render: (row) => row.industry ?? "—" },
          { key: "channel", header: "渠道", render: (row) => row.channel ?? CHANNEL_UNSET_LABEL },
          {
            key: "approvalStatus",
            header: "审批状态",
            render: (row) => (
              <StatusBadge
                status={row.approvalStatus}
                label={APPROVAL_LABELS[row.approvalStatus] ?? row.approvalStatus}
                toneMap={APPROVAL_TONE_MAP}
              />
            ),
          },
          {
            key: "isActive",
            header: "启用",
            render: (row) =>
              row.isActive ? (
                <StatusBadge status="ACTIVE" label="启用" tone="success" />
              ) : (
                <StatusBadge status="INACTIVE" label="停用" tone="neutral" />
              ),
          },
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
            <Link href={`/business-partners/${row.id}`} className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-slate-100">
              详情
            </Link>
            {canEdit && (
              <button type="button" onClick={() => router.push(`/business-partners/${row.id}/edit`)} className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-slate-100">
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
        title={`删除往来单位「${deleting?.name ?? ""}」？`}
        description="往来单位已被客户/供应商/单据引用后不可删除（可编辑）；无引用将软删除并停用。"
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
    <PermissionGuard permission={actionPermission("business-partner", "view")}>
      <BusinessPartnerList />
    </PermissionGuard>
  );
}