/**
 * 商机「最近跟进 + 长期未跟进提醒」MVP 横切 helper（合同「商机管理」②③）
 *
 * 领域事实（零 Schema，复用现有模型）：
 *   ProjectOpportunity.customerId → BusinessPartner（商机必有客户，customerId 非空）
 *   CustomerActivity.businessPartnerId + activityType=FOLLOW_UP → 该客户最近一次跟进时间（createdAt）
 *
 * 阈值：默认 7 天。SystemSetting 尚无对应键（未 seed），按合同用固定默认值常量；
 * 后续如需可配置，再迁移为 SystemSetting key（scope=SYSTEM），本函数只消费入参、无感知。
 *
 * 判定规则（客观事实，纯服务端计算，不信任客户端）：
 *   needsFollowUp = 有效基线距今整天数 >= THRESHOLD
 *   有效基线 = 最近一次 FOLLOW_UP createdAt；从未跟进则退化为商机 createdAt
 *   （"长时间未联系"：从未跟进的旧商机同样需要跟进；新建当日商机（0 天）不误报）
 */

/** 长期未跟进阈值（天）——MVP 固定默认值常量 */
export const OPPORTUNITY_FOLLOWUP_THRESHOLD_DAYS = 7;

const MS_PER_DAY = 86_400_000;

/** 两个时间戳之间的整天数（>=0；未来时间按 0 处理） */
export function daysBetween(from: Date, to: Date): number {
  const diff = to.getTime() - from.getTime();
  return diff <= 0 ? 0 : Math.floor(diff / MS_PER_DAY);
}

export interface OpportunityFollowUpInfo {
  /** 最近一次 FOLLOW_UP 跟进时间（该商机关联客户维度）；从未跟进为 null */
  lastFollowUpAt: string | null;
  /** 距最近跟进整天数；从未跟进为 null（前端显示「—」） */
  daysSinceFollowUp: number | null;
  /** 超过阈值 → 待跟进（红/黄提示，本 MVP 不做后台推送）；从未跟进的旧商机同样判定 */
  needsFollowUp: boolean;
  /** 阈值（天），随响应下发，前端与后端共用同一事实 */
  followUpThresholdDays: number;
}

/**
 * 组装商机跟进信息。
 * @param lastFollowUp 最近一次 FOLLOW_UP createdAt（可为 null）
 * @param opportunityCreatedAt 商机创建时间（从未跟进时作为判定基线）
 * @param now 判定基准时间（测试可注入；默认 now）
 */
export function buildFollowUpInfo(
  lastFollowUp: Date | null,
  opportunityCreatedAt: Date,
  now: Date = new Date(),
): OpportunityFollowUpInfo {
  const baseline = lastFollowUp ?? opportunityCreatedAt;
  const days = daysBetween(baseline, now);
  return {
    lastFollowUpAt: lastFollowUp ? lastFollowUp.toISOString() : null,
    daysSinceFollowUp: lastFollowUp ? days : null,
    needsFollowUp: days >= OPPORTUNITY_FOLLOWUP_THRESHOLD_DAYS,
    followUpThresholdDays: OPPORTUNITY_FOLLOWUP_THRESHOLD_DAYS,
  };
}
