/**
 * Dashboard 待处理工作 — 纯函数（UI-03，可测试）
 *
 * 只消费真实 API 事实（有真实数据源才显示，无 API 不造入口）：
 * - 待确认订单：GET /api/sales-orders/summary → byStatus.DRAFT（DRAFT → confirm → CONFIRMED）
 * - 待审批报销：GET /api/expenses?status=PENDING → meta.total（PENDING 审批流）
 * available=false（权限不足 / API 失败 / 数据源缺失）→ 直接剔除，不显示假入口。
 */
export type PendingTone = "warning" | "neutral";

export interface PendingWorkSource {
  key: string;
  label: string;
  description: string;
  route: string;
  count: number;
  /** 数据源可用（权限通过 + API 成功）；false 直接剔除 */
  available: boolean;
}

export interface PendingWorkItem {
  key: string;
  label: string;
  description: string;
  route: string;
  count: number;
  /** count > 0 → warning（待处理）；0 → neutral */
  tone: PendingTone;
}

/** 待处理工作数据源定义（与真实 API 一一对应；禁止造 backend 不存在的入口） */
export const PENDING_WORK_SOURCES: readonly PendingWorkSource[] = [
  {
    key: "pending-sales-orders",
    label: "待确认订单",
    description: "DRAFT 状态的销售订单，等待确认",
    route: "/sales/orders",
    count: 0,
    available: false,
  },
  {
    key: "pending-expenses",
    label: "待审批报销",
    description: "PENDING 状态的报销申请，等待审批",
    route: "/expenses",
    count: 0,
    available: false,
  },
];

/**
 * 由各数据源实际状态构建待处理工作列表：
 * - 剔除不可用数据源（权限/API/数据源缺失）
 * - count > 0 → warning 语义色；否则 neutral
 * 返回空数组时页面不渲染该区块（无真实数据源不显示）。
 */
export function buildPendingWork(
  sources: readonly PendingWorkSource[],
  overrides: Partial<Record<string, Pick<PendingWorkSource, "count" | "available">>> = {},
): PendingWorkItem[] {
  const items: PendingWorkItem[] = [];
  for (const s of sources) {
    const o = overrides[s.key];
    const available = o?.available ?? s.available;
    if (!available) continue;
    const count = o?.count ?? s.count;
    items.push({
      key: s.key,
      label: s.label,
      description: s.description,
      route: s.route,
      count,
      tone: count > 0 ? "warning" : "neutral",
    });
  }
  return items;
}
