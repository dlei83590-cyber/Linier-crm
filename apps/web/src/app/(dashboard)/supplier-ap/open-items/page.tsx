"use client";

/**
 * AP Open Items — 应付未结项只读列表页（Pending Pages：ap-open-items）
 *
 * 只读投影（5C-1C1 POST 产生 ApOpenItem）：openAmount 为服务端计算，前端不计算不写；
 * 付款/核销/冲销属 5C-2 HOLD，本页不提供任何写入口。
 */
import { useEffect, useState } from "react";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { useListQuery } from "@/lib/use-list-query";
import { apiFetch } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { formatDate, formatMoney } from "@/lib/format";

interface SupplierOption {
  id: string;
  code: string;
  name: string;
}

interface ApOpenItemRow {
  id: string;
  supplierId: string;
  currency: string;
  openAmount: string;
  settlementStatus: string;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  apLiabilityFact?: {
    grossAmount: string;
    dueDate: string | null;
    supplier?: { id: string; code: string; name: string } | null;
    supplierInvoice?: { invoiceNo: string; supplierInvoiceNo: string; documentStatus: string } | null;
  } | null;
}

const SETTLEMENT_LABELS: Record<string, string> = {
  UNPAID: "未结算",
  PARTIALLY_PAID: "部分结算",
  PAID: "已结算",
};

const SETTLEMENT_TONE_MAP: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  UNPAID: "warning",
  PARTIALLY_PAID: "info",
  PAID: "success",
};

function ApOpenItemList() {
  const [supplierInput, setSupplierInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [filters, setFilters] = useState<{ supplierId?: string; settlementStatus?: string }>({});

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<SupplierOption[]>("/api/suppliers?pageSize=100", { signal: controller.signal })
      .then((body) => setSuppliers(body.data))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<ApOpenItemRow>("/api/ap-open-items", filters);

  const applyFilter = () => {
    const next: { supplierId?: string; settlementStatus?: string } = {};
    if (supplierInput) next.supplierId = supplierInput;
    if (statusInput) next.settlementStatus = statusInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setSupplierInput("");
    setStatusInput("");
    setFilters({});
    setPage(1);
  };

  return (
    <AppPage>
      <EntityListWorkspace<ApOpenItemRow>
        title="应付未结项"
        description="已过账供应商发票产生的 AP Open Item（只读投影；openAmount 由服务端计算，付款/核销属 5C-2 HOLD）"
        filters={
          <>
            <select
              value={supplierInput}
              onChange={(e) => setSupplierInput(e.target.value)}
              className="rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            >
              <option value="">全部供应商</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              value={statusInput}
              onChange={(e) => setStatusInput(e.target.value)}
              className="rounded-md border border-border px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            >
              <option value="">全部状态</option>
              <option value="UNPAID">未结算</option>
              <option value="PARTIALLY_PAID">部分结算</option>
              <option value="PAID">已结算</option>
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
          { key: "supplier", header: "供应商", render: (row) => row.apLiabilityFact?.supplier?.name ?? "—" },
          {
            key: "invoiceNo",
            header: "发票号",
            render: (row) => row.apLiabilityFact?.supplierInvoice?.invoiceNo ?? row.apLiabilityFact?.supplierInvoice?.supplierInvoiceNo ?? "—",
          },
          { key: "currency", header: "币种", render: (row) => row.currency ?? "CNY" },
          {
            key: "openAmount",
            header: "未结金额",
            render: (row) => formatMoney(row.openAmount, row.currency),
          },
          {
            key: "settlementStatus",
            header: "结算状态",
            render: (row) => (
              <StatusBadge
                status={row.settlementStatus}
                label={SETTLEMENT_LABELS[row.settlementStatus] ?? row.settlementStatus}
                toneMap={SETTLEMENT_TONE_MAP}
              />
            ),
          },
          { key: "dueDate", header: "到期日", render: (row) => (row.dueDate ? formatDate(row.dueDate) : "—") },
          { key: "updatedAt", header: "更新时间", render: (row) => formatDate(row.updatedAt) },
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
    <PermissionGuard permission={actionPermission("ap-open-item", "view")}>
      <ApOpenItemList />
    </PermissionGuard>
  );
}