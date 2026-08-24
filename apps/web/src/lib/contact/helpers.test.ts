import { describe, it, expect } from 'vitest';
import { computeNextOccurrence, computeRemindAt, isWithinReminderWindow } from './helpers';

/**
 * 2A 联系人特殊日期提醒：nextOccurrence 服务端派生 + 2/29 非闰年按 2/28（CTO Amendment，写入 Test Case）。
 */

function d(y: number, m: number, day: number): Date {
  return new Date(y, m - 1, day);
}

describe('computeNextOccurrence — recurrence YEARLY', () => {
  it('生日 1990-09-20 → 本年度 09-20（未过）', () => {
    const next = computeNextOccurrence(d(1990, 9, 20), 'YEARLY', d(2026, 1, 1));
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(8); // 9 月
    expect(next.getDate()).toBe(20);
  });

  it('生日已过 → 下一年度', () => {
    const next = computeNextOccurrence(d(1990, 1, 15), 'YEARLY', d(2026, 6, 1));
    expect(next.getFullYear()).toBe(2027);
    expect(next.getDate()).toBe(15);
  });

  it('2 月 29 日生日，非闰年（2026）→ 2 月 28 日', () => {
    const next = computeNextOccurrence(d(2000, 2, 29), 'YEARLY', d(2026, 1, 1));
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(1); // 2 月
    expect(next.getDate()).toBe(28); // 非闰年按 2/28
  });

  it('2 月 29 日生日，闰年（2028）→ 2 月 29 日', () => {
    const next = computeNextOccurrence(d(2000, 2, 29), 'YEARLY', d(2028, 1, 1));
    expect(next.getFullYear()).toBe(2028);
    expect(next.getDate()).toBe(29);
  });

  it('NONE 一次性 → 原 date（不派生年度）', () => {
    const date = d(2026, 8, 1);
    const next = computeNextOccurrence(date, 'NONE', d(2026, 1, 1));
    expect(next.getTime()).toBe(date.getTime());
  });
});

describe('computeRemindAt + isWithinReminderWindow', () => {
  it('remindAt = nextOccurrence - remindDaysBefore', () => {
    const remindAt = computeRemindAt(d(2026, 9, 20), 7);
    expect(remindAt.getFullYear()).toBe(2026);
    expect(remindAt.getDate()).toBe(13); // 9/20 - 7 天
  });

  it('remindAt 落在 window 内命中', () => {
    const now = d(2026, 9, 1);
    expect(isWithinReminderWindow(d(2026, 9, 10), now, 30)).toBe(true);
    expect(isWithinReminderWindow(d(2026, 9, 5), now, 3)).toBe(false);
    expect(isWithinReminderWindow(d(2026, 8, 31), now, 30)).toBe(false);
  });
});
