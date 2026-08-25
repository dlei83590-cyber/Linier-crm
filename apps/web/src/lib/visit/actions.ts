/**
 * 拜访行动作解析（UI-05 周/月视图升级）
 *
 * 签到/签退入口只消费后端状态契约（红线：UI 状态机禁止前端自造）：
 * - PENDING（无 CHECK_IN.visitPlanId 指向）→ 可签到
 * - COMPLETED（存在签到明细）且存在未签退的签到 → 可签退
 * 纯函数 → 表格/日历两种视图共用同一判定，杜绝两处不一致。
 */
export type VisitRowAction = "checkin" | "checkout" | null;

/** 与 VisitRow.checkins 元素真实形状一致（含 checkinAt；判定只用 checkoutAt） */
export interface VisitActionCheckin {
  checkinAt: string | null;
  checkoutAt: string | null;
}

export interface VisitActionRow {
  status: string;
  checkins: VisitActionCheckin[];
}

/** 该行当前可执行的动作（null = 无动作；权限仍由调用方 PermissionGuard/actionPermission 把关） */
export function resolveVisitRowAction(row: VisitActionRow): VisitRowAction {
  if (row.status === "PENDING") return "checkin";
  if (row.status === "COMPLETED" && row.checkins.some((c) => c.checkoutAt === null)) {
    return "checkout";
  }
  return null;
}

/** 最近一次签到（含签退信息）；无签到返回 null */
export function latestCheckin<T extends { checkinAt: string | null }>(checkins: T[]): T | null {
  return checkins.length > 0 ? checkins[checkins.length - 1] : null;
}
