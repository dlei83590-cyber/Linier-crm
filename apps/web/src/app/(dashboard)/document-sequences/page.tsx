"use client";

/** Document Sequences — 单据序列列表页（Pending Pages Completion Gate — Batch 1；nextNo 只读） */
import { useState } from "react";
import Link from "next/link";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate } from "@/lib/format";

interface DocumentSequenceRow {
  id: string;
  code: string;
  name: string;
  docType: string;
  prefix: string | null;
  nextNo: number;
  padLength: number;
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
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("document-sequence", "create"));

  const [codeInput, setCodeInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [filters, setFilters] = useState<{ code?: string; name?: string }>({});

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<DocumentSequenceRow>("/api/document-sequences", filters);

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

  return (
    <AppPage>
      <EntityListWorkspace<DocumentSequenceRow>
        title="单据序列"
        description="维护报价/订单/项目等单据编号序列规则（编号由系统引擎管理）"
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
          { key: "nextNo", header: "当前序号", render: (row) => String(row.nextNo).padStart(row.padLength, "0") },
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
    <PermissionGuard permission={actionPermission("document-sequence", "view")}>
      <DocumentSequenceList />
    </PermissionGuard>
  );
}