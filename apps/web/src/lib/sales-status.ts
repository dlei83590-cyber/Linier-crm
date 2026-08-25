/**
 * Sales Chain Status Maps — 销售链单据状态展示单一事实来源（UI-07 FE 2.0）
 *
 * 覆盖：Quotation / SalesOrder / Delivery / Invoice / AR / Receipt / CN-DN。
 * - 内部 key 保留真实后端枚举，禁止跨状态语义压缩（APPROVED ≠ CONFIRMED 等）
 * - 展示文案中文化（label），tone 为 StatusBadge 语义色
 * - 未知状态回退：neutral tone + 原始枚举原文（不伪造业务语义）
 *
 * 页面一律从这里消费 salesStatusLabel / salesStatusTone / SALES_STATUS_OPTIONS，
 * 禁止在列表/详情/表单页重复维护状态映射。
 */
import type { StatusTone } from "@/components/design-system";

export type SalesDocDomain =
  | "quotation"
  | "salesOrder"
  | "delivery"
  | "invoice"
  | "ar"
  | "receipt"
  | "cnDn";

export interface SalesStatusDef {
  label: string;
  tone: StatusTone;
}

const SALES_STATUS: Record<SalesDocDomain, Record<string, SalesStatusDef>> = {
  quotation: {
    DRAFT: { label: "草稿", tone: "neutral" },
    SUBMITTED: { label: "已提交", tone: "info" },
    APPROVED: { label: "已批准", tone: "success" },
    SENT: { label: "已发送", tone: "info" },
    ACCEPTED: { label: "客户已接受", tone: "success" },
    REJECTED: { label: "已拒绝", tone: "danger" },
    CANCELLED: { label: "已取消", tone: "danger" },
    CONVERTED: { label: "已转订单", tone: "info" },
    EXPIRED: { label: "已过期", tone: "warning" },
  },
  salesOrder: {
    DRAFT: { label: "草稿", tone: "neutral" },
    CONFIRMED: { label: "已确认", tone: "success" },
    PARTIALLY_DELIVERED: { label: "部分交付", tone: "warning" },
    DELIVERED: { label: "已交付", tone: "success" },
    COMPLETED: { label: "已完成", tone: "success" },
    CANCELLED: { label: "已取消", tone: "danger" },
  },
  delivery: {
    DRAFT: { label: "草稿", tone: "neutral" },
    READY: { label: "待发运", tone: "info" },
    DISPATCHED: { label: "已发运", tone: "info" },
    DELIVERED: { label: "已送达", tone: "success" },
    COMPLETED: { label: "已完成", tone: "success" },
    CANCELLED: { label: "已取消", tone: "danger" },
  },
  invoice: {
    DRAFT: { label: "草稿", tone: "neutral" },
    ISSUED: { label: "已开票", tone: "info" },
    PARTIALLY_PAID: { label: "部分收款", tone: "warning" },
    PAID: { label: "已收款", tone: "success" },
    CANCELLED: { label: "已取消", tone: "danger" },
  },
  ar: {
    OPEN: { label: "未结清", tone: "warning" },
    PARTIALLY_PAID: { label: "部分收款", tone: "warning" },
    PAID: { label: "已结清", tone: "success" },
    OVERDUE: { label: "已逾期", tone: "danger" },
    CLOSED: { label: "已关闭", tone: "neutral" },
  },
  receipt: {
    UNALLOCATED: { label: "未核销", tone: "info" },
    PARTIALLY_ALLOCATED: { label: "部分核销", tone: "warning" },
    FULLY_ALLOCATED: { label: "已核销", tone: "success" },
    VOIDED: { label: "已作废", tone: "danger" },
  },
  cnDn: {
    DRAFT: { label: "草稿", tone: "neutral" },
    SUBMITTED: { label: "已提交", tone: "info" },
    APPLIED: { label: "已应用", tone: "success" },
    REVERSED: { label: "已反冲", tone: "warning" },
    CANCELLED: { label: "已取消", tone: "danger" },
  },
};

/** 审批状态投影（CN/DN 等 workflowInstance） */
export const APPROVAL_STATUS: Record<string, SalesStatusDef> = {
  DRAFT: { label: "草稿", tone: "neutral" },
  PENDING: { label: "待审批", tone: "warning" },
  APPROVED: { label: "已批准", tone: "success" },
  REJECTED: { label: "已拒绝", tone: "danger" },
};

/** 各域筛选下拉可选项（与列表页一致；EXPIRED 等惰性投影不在可选项中） */
export const SALES_STATUS_OPTIONS: Record<SalesDocDomain, readonly string[]> = {
  quotation: [
    "DRAFT",
    "SUBMITTED",
    "APPROVED",
    "SENT",
    "ACCEPTED",
    "REJECTED",
    "CANCELLED",
    "CONVERTED",
  ],
  salesOrder: ["DRAFT", "CONFIRMED", "PARTIALLY_DELIVERED", "DELIVERED", "COMPLETED", "CANCELLED"],
  delivery: ["DRAFT", "READY", "DISPATCHED", "DELIVERED", "COMPLETED", "CANCELLED"],
  invoice: ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "CANCELLED"],
  ar: ["OPEN", "PARTIALLY_PAID", "PAID", "OVERDUE", "CLOSED"],
  receipt: ["UNALLOCATED", "PARTIALLY_ALLOCATED", "FULLY_ALLOCATED", "VOIDED"],
  cnDn: ["DRAFT", "SUBMITTED", "APPLIED", "REVERSED", "CANCELLED"],
};

export function salesStatusDef(
  domain: SalesDocDomain,
  status: string | null | undefined,
): SalesStatusDef {
  const def = status ? SALES_STATUS[domain][status] : undefined;
  return def ?? { label: status ?? "—", tone: "neutral" };
}

export function salesStatusLabel(
  domain: SalesDocDomain,
  status: string | null | undefined,
): string {
  return salesStatusDef(domain, status).label;
}

export function salesStatusTone(
  domain: SalesDocDomain,
  status: string | null | undefined,
): StatusTone {
  return salesStatusDef(domain, status).tone;
}

export function approvalStatusDef(status: string | null | undefined): SalesStatusDef {
  const def = status ? APPROVAL_STATUS[status] : undefined;
  return def ?? { label: status ?? "—", tone: "neutral" };
}
