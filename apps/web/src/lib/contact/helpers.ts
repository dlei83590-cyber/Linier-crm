import { Prisma } from '@prisma/client';

/**
 * 2A 联系人管理领域函数（不放路由逻辑）
 *
 * - 特殊日期提醒：recurrence（NONE|YEARLY）→ nextOccurrence（服务端派生，禁止前端判断）
 * - remindAt = nextOccurrence - remindDaysBefore
 * - 2 月 29 日非闰年按 2 月 28 日提醒（CTO Amendment）
 * - Date-only 业务日期：用本地时区分量构造（getFullYear/getMonth/getDate），不做 UTC 跨日换算
 */

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** 计算特殊日期下一次发生日（本地日期口径；不跨日） */
export function computeNextOccurrence(
  date: Date,
  recurrence: 'NONE' | 'YEARLY',
  now: Date,
): Date {
  if (recurrence === 'NONE') {
    return date;
  }
  const m = date.getMonth() + 1;
  const rawDay = date.getDate();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // 2/29 非闰年按 2/28
  if (m === 2 && rawDay === 29) {
    let year = now.getFullYear();
    let day = isLeapYear(year) ? 29 : 28;
    let candidate = new Date(year, 1, day);
    if (candidate.getTime() < today.getTime()) {
      year += 1;
      day = isLeapYear(year) ? 29 : 28;
      candidate = new Date(year, 1, day);
    }
    return candidate;
  }

  let candidate = new Date(now.getFullYear(), m - 1, rawDay);
  if (candidate.getTime() < today.getTime()) {
    candidate = new Date(now.getFullYear() + 1, m - 1, rawDay);
  }
  return candidate;
}

/** remindAt = nextOccurrence - remindDaysBefore */
export function computeRemindAt(nextOccurrence: Date, remindDaysBefore: number): Date {
  const d = new Date(nextOccurrence);
  d.setDate(d.getDate() - remindDaysBefore);
  return d;
}

/** upcoming-reminders 是否命中窗口（now <= remindAt <= now + windowDays） */
export function isWithinReminderWindow(remindAt: Date, now: Date, windowDays: number): boolean {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + windowDays);
  return remindAt.getTime() >= start.getTime() && remindAt.getTime() <= end.getTime();
}
