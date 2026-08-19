"use client";

/** Supplier Payments — 付款核销列表页（5C-2，CTO 解锁 2026-08-19） */
import { useEffect, useState } from "react";
import Link from "next/link";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate, formatMoney } from "@/lib/format";

interface PaymentRow {
  id: string;
  code: string;
  currency: string;
  amount: string;
  allocatedAmount: string;
  unallocatedAmount: string;
  paymentDate: string;
  status: string;
  voidedAt: string | null;
  supplier?: { id: string; code: string; name: string } | null;
}

const STATUS_LABELS: Record<string, string> = { UNALLOCATED: "未核销", PARTIALLY_ALLOCATED: "部分核销", ALLOCATED: "已全额核销" };
const STATUS_TONE_MAP: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { UNALLOCATED: "neutral", PARTIALLY_ALLOCATED: "info", ALLOCATED: "success" };

function PaymentList() {
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("supplier-payment", "create"));
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string | null }>>([]);
  const [supplierInput, setSupplierInput] = useState("");
  const [dateFromInput, setDateFromInput] = useState("");
  const [dateToInput, setDateToInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ supplierId?: string; dateFrom?: string; dateTo?: string; status?: string }>({});

  useEffect(() => {
    apiFetch<Array<{ id: string; name: string | null }>>("/api/suppliers?pageSize=100")
      .then((body) => setSuppliers(Array.isArray(body.data) ? body.data : []))
      .catch(() => undefined);
  }, []);

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<PaymentRow>("/api/supplier-payments", filters);

  const applyFilter = () => {
    const next: { supplierId?: string; dateFrom?: string; dateTo?: string; status?: string } = {};
    if (supplierInput) next.supplierId = supplierInput;
    if (dateFromInput) next.dateFrom = dateFromInput;
    if (dateToInput) next.dateTo = dateToInput;
    if (statusInput) next.status = statusInput;
    setFilters(next); setPage(1);
  };
  const resetFilter = () => { setSupplierInput(""); setDateFromInput(""); setDateToInput(""); setStatusInput(""); setFilters({}); setPage(1); };

  return (
    <AppPage>
      <EntityListWorkspace<PaymentRow>
        title="付款核销"
        description="供应商付款单与应付未结项核销（Created ≠ Applied；Apply 唯一回写结算投影；防超核销锁内重算）"
        headerActions={
          canCreate ? (
            <Link href="/supplier-ap/payments/new" className={BUTTON_PRIMARY_CLASS}>
              + 新建付款单
            </Link>
          ) : undefined
        }
        filters={
          <>
            <select value={supplierInput} onChange={(e) => setSupplierInput(e.target.value)} className={SELECT_CLASS}>
              <option value="">全部供应商</option>
              {suppliers.map((s) => (<option key={s.id} value={s.id}>{s.name ?? s.id}</option>))}
            </select>
            <input type="date" value={dateFromInput} onChange={(e) => setDateFromInput(e.target.value)} className={SELECT_CLASS} />
            <input type="date" value={dateToInput} onChange={(e) => setDateToInput(e.target.value)} className={SELECT_CLASS} />
            <select value={statusInput} onChange={(e) => setStatusInput(e.target.value)} className={SELECT_CLASS}>
              <option value="">全部状态</option>
              <option value="UNALLOCATED">未核销</option>
              <option value="PARTIALLY_ALLOCATED">部分核销</option>
              <option value="ALLOCATED">已全额核销</option>
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
          { key: "code", header: "付款单号", render: (row) => (<Link href={`/supplier-ap/payments/${row.id}`} className="font-medium text-brand-600 hover:underline">{row.code}</Link>) },
          { key: "supplier", header: "供应商", render: (row) => row.supplier?.name ?? "—" },
          { key: "amount", header: "付款金额", render: (row) => formatMoney(row.amount, row.currency) },
          { key: "unallocatedAmount", header: "未核销余额", render: (row) => formatMoney(row.unallocatedAmount, row.currency) },
          { key: "paymentDate", header: "付款日期", render: (row) => formatDate(row.paymentDate) },
          { key: "status", header: "状态", render: (row) => (<StatusBadge status={row.status} label={STATUS_LABELS[row.status] ?? row.status} toneMap={STATUS_TONE_MAP} />) },
          { key: "voidedAt", header: "作废", render: (row) => (row.voidedAt ? "已作废" : "—") },
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
    <PermissionGuard permission={actionPermission("supplier-payment", "view")}>
      <PaymentList />
    </PermissionGuard>
  );
}