"use client";

/**
 * Customer 360 — 摘要 KPI 条（FE 2.0）
 *
 * 数据全部来自权威 API 投影（页面聚合后以 props 注入，本组件纯展示）：
 * 联系人（detail.partnerContacts）/ 商机数（列表 meta.total）/ 最近跟进（activities 最新一条）/
 * 最近订单（sales-orders 最新一条）/ 累计销售（sales-orders meta.total 订单数——
 * 无 per-customer 服务端汇总 API，禁止客户端求和伪造权威累计额，PR body 声明）/ 客户状态。
 * loading（data=null）→ 骨架；reduced-motion 无额外动效。
 */
import { StatusBadge } from "@/components/workspace";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatMoneyValue } from "@/lib/format";
import { activityTypeMeta } from "@/lib/customer/activity-meta";
import {
  IconCheckCircle,
  IconClock,
  IconFileText,
  IconTarget,
  IconTrendingUp,
  IconUsers,
} from "./icons";

export interface CustomerSummaryData {
  contactCount: number;
  opportunityCount: number;
  latestActivity: { type: string; occurredAt: string | null } | null;
  latestOrder: { id: string; code: string; totalAmount: string; currency: string } | null;
  orderCount: number;
  approvalStatus: string | null;
  isActive: boolean;
}

function SummaryCard({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4 shadow-elevation-sm">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-domain-customer-project-50 text-domain-customer-project-600">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs text-ink-secondary">{label}</p>
        <div className="mt-1 text-sm font-medium text-ink-primary">{children}</div>
      </div>
    </div>
  );
}

export function CustomerSummary({ data }: { data: CustomerSummaryData | null }) {
  if (!data) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-surface p-4 shadow-elevation-sm">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-5 w-24" />
          </div>
        ))}
      </div>
    );
  }

  const latestActivityLabel = data.latestActivity
    ? activityTypeMeta(data.latestActivity.type).label +
      " · " +
      formatDate(data.latestActivity.occurredAt)
    : "暂无跟进";

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <SummaryCard icon={<IconUsers className="h-4 w-4" />} label="联系人">
        <span className="tabular-nums">{data.contactCount}</span>
      </SummaryCard>
      <SummaryCard icon={<IconTarget className="h-4 w-4" />} label="商机">
        <span className="tabular-nums">{data.opportunityCount}</span>
      </SummaryCard>
      <SummaryCard icon={<IconClock className="h-4 w-4" />} label="最近跟进">
        <span title={latestActivityLabel} className="block max-w-[150px] truncate">
          {latestActivityLabel}
        </span>
      </SummaryCard>
      <SummaryCard icon={<IconFileText className="h-4 w-4" />} label="最近订单">
        {data.latestOrder ? (
          <span
            title={data.latestOrder.code + " · " + formatMoneyValue(data.latestOrder.totalAmount) + " " + (data.latestOrder.currency ?? "")}
            className="block max-w-[150px] truncate"
          >
            {data.latestOrder.code}
            <span className="ml-1 tabular-nums text-ink-secondary">
              {formatMoneyValue(data.latestOrder.totalAmount)}
            </span>
          </span>
        ) : (
          "暂无订单"
        )}
      </SummaryCard>
      <SummaryCard icon={<IconTrendingUp className="h-4 w-4" />} label="累计销售">
        <span className="tabular-nums">{data.orderCount}</span>
        <span className="ml-1 text-xs text-ink-secondary">笔订单</span>
      </SummaryCard>
      <SummaryCard icon={<IconCheckCircle className="h-4 w-4" />} label="客户状态">
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge
            status={data.approvalStatus ?? "UNKNOWN"}
            label={
              data.approvalStatus
                ? ({ DRAFT: "草稿", SUBMITTED: "已提交", APPROVED: "已批准", REJECTED: "已拒绝" } as Record<string, string>)[
                    data.approvalStatus
                  ] ?? data.approvalStatus
                : "—"
            }
            toneMap={{
              DRAFT: "neutral",
              SUBMITTED: "info",
              APPROVED: "success",
              REJECTED: "danger",
            }}
          />
          {!data.isActive && <span className="text-xs text-status-danger-text">已停用</span>}
        </span>
      </SummaryCard>
    </div>
  );
}
