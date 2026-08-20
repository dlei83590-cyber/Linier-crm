"use client";

/**
 * Sales Orders — 销售订单列表页（F2-6A Sales Read Foundation）
 *
 * 只读 List：AppPage → EntityListWorkspace → useListQuery。
 * 不提供新建按钮（SO 唯一入口是 Quotation Convert，F2-6B）。
 * PermissionGuard 对齐 API requirePermission("sales-order:view")。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { actionPermission } from "@nilier-crm/shared";
import type { StatusTone } from "@/components/design-system";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace, StatusBadge } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";
import { apiFetch } from "@/lib/api-client";
import { formatDate, formatMoney } from "@/lib/format";

interface SalesOrderRow {
  id: string;
  code: string;
  status: string;
  orderDate: string;
  currency: string;
  totalAmount: string;
  customer?: { id: string; code: string | null; name: string | null } | null;
  quotation?: { id: string; code: string | null } | null;
  _count?: { lines: number };
}

const STATUS_OPTIONS = ["DRAFT", "CONFIRMED", "PARTIALLY_DELIVERED", "DELIVERED", "COMPLETED", "CANCELLED"] as const;

/** 状态中文业务名（Business UX Rationalization：枚举展示中文，不展示数据库枚举值；key 保留真实 enum） */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  CONFIRMED: "已确认",
  PARTIALLY_DELIVERED: "部分交付",
  DELIVERED: "已交付",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};

const TONE_MAP: Record<string, StatusTone> = {
  DRAFT: "neutral",
  CONFIRMED: "success",
  PARTIALLY_DELIVERED: "warning",
  DELIVERED: "success",
  COMPLETED: "success",
  CANCELLED: "danger",
};

function SalesOrderList() {
  const [customers, setCustomers] = useState<Array<{ id: string; name: string | null }>>([]);
  const [customerInput, setCustomerInput] = useState("");
  const [dateFromInput, setDateFromInput] = useState("");
  const [dateToInput, setDateToInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [filters, setFilters] = useState<{ code?: string; customerId?: string; status?: string; dateFrom?: string; dateTo?: string }>({});

  useEffect(() => {
    apiFetch<Array<{ id: string; name: string | null }>>("/api/business-partners?pageSize=100&type=CUSTOMER")
      .then((body) => setCustomers(Array.isArray(body.data) ? body.data : []))
      .catch(() => undefined);
  }, []);

  const { items, total, page, pageSize, loading, error, setPage, refresh } =
    useListQuery<SalesOrderRow>("/api/sales-orders", filters);

  const applyFilter = () => {
    const next: { code?: string; customerId?: string; status?: string; dateFrom?: string; dateTo?: string } = {};
    if (codeInput.trim()) next.code = codeInput.trim();
    if (customerInput) next.customerId = customerInput;
    if (dateFromInput) next.dateFrom = dateFromInput;
    if (dateToInput) next.dateTo = dateToInput;
    if (statusInput) next.status = statusInput;
    setFilters(next);
    setPage(1);
  };

  const resetFilter = () => {
    setCodeInput("");
    setCustomerInput("");
    setDateFromInput("");
    setDateToInput("");
    setStatusInput("");
    setFilters({});
    setPage(1);
  };

  return (
    <AppPage>
      <EntityListWorkspace<SalesOrderRow>
        title="销售订单"
        description="销售订单列表（唯一创建入口：报价单 Convert）"
        emptyMessage="暂无销售订单——销售订单由报价单 Convert 创建，请先在报价单详情页执行 Convert"
        filters={
          <>
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="按单号搜索"
              className={"w-40 " + SELECT_CLASS}
            />
            <select value={customerInput} onChange={(e) => setCustomerInput(e.target.value)} className={SELECT_CLASS}>
              <option value="">全部客户</option>
              {customers.map((c) => (<option key={c.id} value={c.id}>{c.name ?? c.id}</option>))}
            </select>
            <input type="date" value={dateFromInput} onChange={(e) => setDateFromInput(e.target.value)} className={SELECT_CLASS} />
            <input type="date" value={dateToInput} onChange={(e) => setDateToInput(e.target.value)} className={SELECT_CLASS} />
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
            header: "单号",
            render: (row) => (
              <Link
                href={`/sales/orders/${row.id}`}
                className="font-medium text-brand-600 hover:underline"
              >
                {row.code}
              </Link>
            ),
          },
          {
            key: "status",
            header: "状态",
            render: (row) => (
              <StatusBadge
                status={row.status}
                label={STATUS_LABELS[row.status] ?? row.status}
                toneMap={TONE_MAP}
              />
            ),
          },
          {
            key: "customer",
            header: "客户",
            render: (row) => row.customer?.name ?? "—",
          },
          {
            key: "quotation",
            header: "来源报价单",
            render: (row) =>
              row.quotation ? (
                <Link
                  href={`/sales/quotations/${row.quotation.id}`}
                  className="text-brand-600 hover:underline"
                >
                  {row.quotation.code}
                </Link>
              ) : (
                "—"
              ),
          },
          {
            key: "orderDate",
            header: "下单日期",
            render: (row) => formatDate(row.orderDate),
          },
          {
            key: "totalAmount",
            header: "含税合计",
            align: "right",
            render: (row) => formatMoney(row.totalAmount, row.currency),
          },
          {
            key: "lines",
            header: "行数",
            render: (row) => String(row._count?.lines ?? 0),
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
      />
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("sales-order", "view")}>
      <SalesOrderList />
    </PermissionGuard>
  );
}