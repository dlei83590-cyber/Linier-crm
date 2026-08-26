/**
 * Customer 360 — 跟进活动展示元数据（FE 2.0 纯函数，零 React 依赖）
 *
 * 只做「展示映射」：活动类型/审批状态 → 中文文案 + 语义 tone + 图标 key。
 * 不改变任何业务语义（活动类型/状态 enum 原样透传），未知值回退原值 + neutral。
 * 供 activity-timeline（时间线节点/徽标）与 customer-summary（最近跟进）复用。
 */
import type { StatusTone } from "@/components/design-system";

export type ActivityTypeKey =
  | "FOLLOW_UP"
  | "VISIT_PLAN"
  | "CHECK_IN"
  | "COMMENT"
  | "APPROVAL";

export interface ActivityTypeMeta {
  /** 原始 enum 值（FOLLOW_UP 等；COMMENT/APPROVAL 为时间线派生子事件） */
  key: ActivityTypeKey;
  /** 中文展示文案 */
  label: string;
  /** 语义 tone（节点底色/类型徽标） */
  tone: StatusTone;
  /** 图标 key（icons.tsx 消费；Lucide 风格，禁止 emoji） */
  icon: "follow-up" | "visit-plan" | "check-in" | "comment" | "approval";
}

const ACTIVITY_TYPE_META: Record<ActivityTypeKey, ActivityTypeMeta> = {
  FOLLOW_UP: { key: "FOLLOW_UP", label: "跟进", tone: "info", icon: "follow-up" },
  VISIT_PLAN: { key: "VISIT_PLAN", label: "拜访计划", tone: "warning", icon: "visit-plan" },
  CHECK_IN: { key: "CHECK_IN", label: "签到", tone: "success", icon: "check-in" },
  COMMENT: { key: "COMMENT", label: "评论", tone: "neutral", icon: "comment" },
  APPROVAL: { key: "APPROVAL", label: "审批", tone: "info", icon: "approval" },
};

export function activityTypeMeta(type: string | null | undefined): ActivityTypeMeta {
  if (!type) return ACTIVITY_TYPE_META.FOLLOW_UP;
  return (
    (ACTIVITY_TYPE_META as Record<string, ActivityTypeMeta>)[type] ?? {
      key: "FOLLOW_UP",
      label: type,
      tone: "neutral",
      icon: "follow-up",
    }
  );
}

export interface FollowUpLevelMeta {
  label: string;
  tone: StatusTone;
}

const FOLLOW_UP_LEVEL_META: Record<string, FollowUpLevelMeta> = {
  BASIC: { label: "普通跟进", tone: "neutral" },
  IMPORTANT: { label: "重点跟进", tone: "warning" },
  DECISION: { label: "决策推进", tone: "danger" },
};

/**
 * 跟进程度展示元数据（followup-level，Migration 0055）；null（未分级：历史记录/系统生成草稿/VISIT_PLAN/CHECK_IN）
 * → null（不渲染徽标）。未知值回退原值 + neutral（禁止静默吞掉未知 enum，与 activityTypeMeta 同约定）。
 */
export function activityFollowUpLevelMeta(
  level: string | null | undefined,
): FollowUpLevelMeta | null {
  if (!level) return null;
  return FOLLOW_UP_LEVEL_META[level] ?? { label: level, tone: "neutral" };
}

export interface ActivityStatusMeta {
  label: string;
  tone: StatusTone;
}

const ACTIVITY_STATUS_META: Record<string, ActivityStatusMeta> = {
  DRAFT: { label: "待提交", tone: "neutral" },
  SUBMITTED: { label: "待审批", tone: "warning" },
  APPROVED: { label: "已批准", tone: "success" },
  REJECTED: { label: "已驳回", tone: "danger" },
};

/**
 * 跟进审批状态展示元数据；null（VISIT_PLAN/CHECK_IN 不参与审批）→ null（不渲染徽标）。
 */
export function activityStatusMeta(
  status: string | null | undefined,
): ActivityStatusMeta | null {
  if (!status) return null;
  return ACTIVITY_STATUS_META[status] ?? { label: status, tone: "neutral" };
}
