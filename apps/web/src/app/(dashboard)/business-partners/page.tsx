"use client";

/**
 * Business Partners — 往来单位列表页（Pending Pages Completion Gate — Batch 1）
 *
 * 统一往来单位主数据：客户/供应商/客户兼供应商。
 */
import { useState } from "react";
import Link from "next/link";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";

interface BusinessPartnerRow {
  id: string;
  code: string;
  name: string;
  mnemonic: string | null;
  type: string;
  region: string | null;
  industry: string | null;
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
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("business-partner", "create"));

  const [codeInput, setCodeInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [typeInput, setTypeInput] = useState("");
  const [regionInput, setRegionInput] = useState("");
  const [filters, setFilters] = useState<{ code?: string; name?: string; type?: string; region?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<BusinessPartnerRow>("/api/business-partners", filters);

  const applyFilter = () => {
    const next: { code?: string; name?: string; type?: string; region?: string } = {};
    if (codeInput.trim()) next.code = codeInput.trim();
    if (nameInput.trim()) next.name = nameInput.trim();
    if (typeInput) next.type = typeInput;
    if (regionInput.trim()) next.region = regionInput.trim();
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setCodeInput("");
    setNameInput("");
    setTypeInput("");
    setRegionInput("");
    setFilters({});
    setPage(1);
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
              <Link href={`/business-partners/${row.id}/edit`} className="font-medium text-brand-600 hover:underline">
                {row.code}
              </Link>
            ),
          },
          { key: "name", header: "名称" },
          { key: "mnemonic", header: "助记码", render: (row) => row.mnemonic ?? "—" },
          { key: "type", header: "类型", render: (row) => TYPE_LABELS[row.type] ?? row.type },
          { key: "region", header: "区域", render: (row) => row.region ?? "—" },
          { key: "industry", header: "行业", render: (row) => row.industry ?? "—" },
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