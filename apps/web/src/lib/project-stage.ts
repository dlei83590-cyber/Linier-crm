/**
 * Project / Opportunity UI 状态文案与阶段映射（UI-06 Opportunity + Project 现代重构）
 *
 * 单一展示映射来源：阶段/优先级/回款状态/子资源状态的中文文案与语义色 tone，
 * 由列表页、详情页、表单页统一消费，禁止各页重复定义第二套映射。
 * 纯展示层映射：不承载任何业务判定（阶段流转规则见 lib/project-transition.ts）。
 */
import type { StatusTone } from "@/components/design-system";

/** 项目/商机阶段 → 中文文案（11 阶段全覆盖） */
export const PROJECT_STAGE_LABELS: Record<string, string> = {
  LEAD: "线索",
  QUALIFIED: "准入",
  SOLUTION: "方案",
  QUOTATION: "报价",
  SAMPLING: "试样",
  TESTING: "测试",
  SMALL_BATCH: "小批量",
  MASS_SUPPLY: "批量供货",
  PAUSED: "暂停",
  FAILED: "失败",
  CLOSED: "结项",
};

/** 项目/商机阶段 → 语义色 tone（用于 StatusBadge） */
export const PROJECT_STAGE_TONES: Record<string, StatusTone> = {
  LEAD: "neutral",
  QUALIFIED: "info",
  SOLUTION: "info",
  QUOTATION: "warning",
  SAMPLING: "neutral",
  TESTING: "warning",
  SMALL_BATCH: "warning",
  MASS_SUPPLY: "success",
  PAUSED: "warning",
  FAILED: "danger",
  CLOSED: "neutral",
};

/** 阶段下拉选项（表单 Select 用；顺序 = 阶段推进顺序 + 暂停/失败/结项） */
export const PROJECT_STAGE_OPTIONS: Array<{ value: string; label: string }> = [
  "LEAD",
  "QUALIFIED",
  "SOLUTION",
  "QUOTATION",
  "SAMPLING",
  "TESTING",
  "SMALL_BATCH",
  "MASS_SUPPLY",
  "PAUSED",
  "FAILED",
  "CLOSED",
].map((s) => ({ value: s, label: PROJECT_STAGE_LABELS[s] ?? s }));

export function projectStageLabel(stage: string | null | undefined): string {
  if (!stage) return "—";
  return PROJECT_STAGE_LABELS[stage] ?? stage;
}

export function projectStageTone(stage: string | null | undefined): StatusTone {
  if (!stage) return "neutral";
  return PROJECT_STAGE_TONES[stage] ?? "neutral";
}

/** 优先级 → 中文文案 */
export const PROJECT_PRIORITY_LABELS: Record<string, string> = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
};

export const PROJECT_PRIORITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "HIGH", label: "高" },
  { value: "MEDIUM", label: "中" },
  { value: "LOW", label: "低" },
];

/** 回款状态 → 中文文案 */
export const PROJECT_PAYMENT_LABELS: Record<string, string> = {
  UNPAID: "未回款",
  PARTIAL: "部分回款",
  PAID: "已回款",
  OVERDUE: "逾期",
};

export const PROJECT_PAYMENT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "UNPAID", label: "未回款" },
  { value: "PARTIAL", label: "部分回款" },
  { value: "PAID", label: "已回款" },
  { value: "OVERDUE", label: "逾期" },
];

/** 任务状态 → 中文文案 */
export const PROJECT_TASK_STATUS_LABELS: Record<string, string> = {
  TODO: "待办",
  IN_PROGRESS: "进行中",
  DONE: "已完成",
  CANCELLED: "已取消",
};

/** 风险状态 → 中文文案 */
export const PROJECT_RISK_STATUS_LABELS: Record<string, string> = {
  OPEN: "开启",
  MITIGATING: "应对中",
  CLOSED: "已关闭",
};

/** 风险概率 → 中文文案 */
export const PROJECT_RISK_PROBABILITY_LABELS: Record<string, string> = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
};

/** 里程碑状态 → 中文文案 */
export const PROJECT_MILESTONE_STATUS_LABELS: Record<string, string> = {
  PLANNED: "计划中",
  IN_PROGRESS: "进行中",
  COMPLETED: "已完成",
  DELAYED: "已延期",
};

/** 关系人角色 → 中文文案 */
export const PROJECT_STAKEHOLDER_ROLE_LABELS: Record<string, string> = {
  REQUESTER: "需求人",
  TECHNICAL: "技术人",
  PURCHASER: "采购人",
  DECISION_MAKER: "决策人",
  END_USER: "使用人",
};

/** 走访类型 → 中文文案 */
export const PROJECT_VISIT_TYPE_LABELS: Record<string, string> = {
  VISIT: "走访",
  PHONE: "电话",
  VIDEO: "视频",
  MEETING: "会议",
  OTHER: "其他",
};

/** 验收结果 → 中文文案 + tone */
export const PROJECT_ACCEPTANCE_RESULT_LABELS: Record<string, string> = {
  PASSED: "通过",
  CONDITIONAL_PASS: "有条件通过",
  FAILED: "不通过",
  PENDING: "待验收",
};

export const PROJECT_ACCEPTANCE_TONES: Record<string, StatusTone> = {
  PASSED: "success",
  CONDITIONAL_PASS: "warning",
  FAILED: "danger",
  PENDING: "neutral",
};

/** 子资源类型 → 中文文案（删除确认等场景） */
export const PROJECT_SUBRESOURCE_LABELS: Record<string, string> = {
  stakeholder: "关系人",
  member: "成员",
  milestone: "里程碑",
  task: "任务",
  risk: "风险",
  visit: "走访记录",
  product: "产品",
  tag: "标签",
  budget: "预算",
  expense: "费用",
  progress: "进度记录",
  acceptance: "验收项",
};
