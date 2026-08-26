"use client";

/** Document Sequences — 单据序列列表页（Pending Pages Completion Gate — Batch 1；nextNo 只读） */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, ConfirmActionDialog } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery, readUrlFilterParams } from "@/lib/use-list-query";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";
import { sequenceFormatPreview } from "@/lib/document-sequence/format";

interface DocumentSequenceRow {
  id: string;
  code: string;
  name: string;
  docType: string;
  prefix: string | null;
  startNo: number;
  padLength: number;
  periodPattern: string | null;
  perPeriodReset: boolean;
  isActive: boolean;
  createdAt: string;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  QUOTATION: "报价单",
  SALES_ORDER: "销售订单",
  PURCHASE_ORDER: "采购订单",
  PURCHASE_REQUISITION: "采购申请",
  PROFORMA_INVOICE: "形式发票",
  COMMERCIAL_INVOICE: "商业发票",
  DELIVERY_ORDER: "送货单",
  GOODS_RECEIPT_NOTE: "收货单",
  GOODS_ISSUE: "出库单",
  INVOICE: "发票",
  CREDIT_NOTE: "贷项通知单",
  DEBIT_NOTE: "借项通知单",
  PAYMENT_VOUCHER: "付款凭证",
  RECEIPT: "收款收据",
  WRITE_OFF: "坏账/折让",
  EXPENSE: "费用报销",
  JOURNAL: "日记账",
  CONTRACT: "合同",
  PROJECT: "项目",
  PURCHASE_RECEIPT: "采购收货单",
  WAREHOUSE_RECEIPT: "采购入库单",
  PURCHASE_RETURN: "采购退货单",
  INVENTORY_MOVEMENT: "库存流水",
  INVENTORY_TRANSFER: "调拨单",
  STOCK_COUNT: "盘点单",
  INVENTORY_ADJUSTMENT: "库存调整单",
  INVENTORY_CONVERSION: "库存转换单",
  SUPPLIER_INVOICE: "供应商发票",
};

function DocumentSequenceList() {
  const router = useRouter();
  const toast = useToast();
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];
  const canCreate = hasPermission(roles, actionPermission("document-sequence", "create"));
  const canEdit = hasPermission(roles, actionPermission("document-sequence", "edit"));
  const canDelete = hasPermission(roles, actionPermission("document-sequence", "delete"));
  const [deleting, setDeleting] = useState<DocumentSequenceRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [codeInput, setCodeInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [filters, setFilters] = useState<{ code?: string; name?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, setPageSize, refresh } =
    useListQuery<DocumentSequenceRow>("/api/document-sequences", filters, 20, { syncUrl: true });

  // URL 筛选恢复（hydration 后一次性应用；刷新/分享后筛选不丢失）
  const urlRestored = useRef(false);
  useEffect(() => {
    if (urlRestored.current) return;
    urlRestored.current = true;
    const u = readUrlFilterParams(["code", "name"]);
    setCodeInput(u.code ?? "");
    setNameInput(u.name ?? "");
    setFilters(() => {
      const n: { code?: string; name?: string } = {};
      if (u.code) n.code = u.code;
      if (u.name) n.name = u.name;
      return n;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      await apiFetch(`/api/document-sequences/${deleting.id}`, { method: "DELETE" });
      toast.success("单据序列已删除");
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
      <EntityListWorkspace<DocumentSequenceRow>
        title="单据序列"
        description="维护单据编号序列规则（格式：前缀-LNE{年月}{序号}，按月重排；编号由系统引擎管理）"
        emptyMessage="暂无编号序列规则"
        headerActions={
          canCreate ? (
            <Link
              href="/document-sequences/new"
              className={BUTTON_PRIMARY_CLASS}
            >
              + 新建单据序列
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
              <Link href={`/document-sequences/${row.id}/edit`} className="font-medium text-brand-600 hover:underline">
                {row.code}
              </Link>
            ),
          },
          { key: "name", header: "名称" },
          { key: "docType", header: "单据类型", render: (row) => DOC_TYPE_LABELS[row.docType] ?? row.docType },
          { key: "prefix", header: "前缀", render: (row) => row.prefix ?? "—" },
          { key: "format", header: "编号格式（示例）", render: (row) => sequenceFormatPreview({ prefix: row.prefix, periodPattern: row.periodPattern, padLength: row.padLength }) },
          { key: "startNo", header: "起始序号", render: (row) => String(row.startNo) },
          { key: "perPeriodReset", header: "按月重排", render: (row) => (row.perPeriodReset ? "是" : "否") },
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
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        activeFilters={[
          filters.code ? { key: "code", label: `编码：${filters.code}`, onClear: () => { setCodeInput(""); setFilters((prev) => { const n = { ...prev }; delete n.code; return n; }); } } : null,
          filters.name ? { key: "name", label: `名称：${filters.name}`, onClear: () => { setNameInput(""); setFilters((prev) => { const n = { ...prev }; delete n.name; return n; }); } } : null,
        ].filter((c): c is NonNullable<typeof c> => c !== null)}
        rowActions={(row) => (
          <div className="flex justify-end gap-1">
            {canEdit && (
              <button type="button" onClick={() => router.push(`/document-sequences/${row.id}/edit`)} className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-surface-hover">
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
        title={`删除单据序列「${deleting?.name ?? ""}」？`}
        description="删除后该单据类型将无法继续取号；已有单据不受影响。确认删除？"
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
    <PermissionGuard permission={actionPermission("document-sequence", "view")}>
      <DocumentSequenceList />
    </PermissionGuard>
  );
}