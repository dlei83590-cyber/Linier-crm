/**
 * 拜访计划日历纯函数（UI-05 周/月视图升级）
 *
 * - 全部按北京时间（UTC+8，固定无 DST）自然日计算，与 /api/visits 的 chinaTimeRange 一致
 *   （后端范围也是北京时间周/月边界；前端日历分组必须与后端同源，禁止出现时区错位）。
 * - 表示方式：每个自然日用「UTC 字段 = 北京墙钟」的 Date 表示（cnMidnight = 北京 0 点），
 *   与 lib/visit/geo.ts chinaTimeRange 的约定一致。
 * - 纯函数、无副作用、无 DOM 依赖 → 可直接单测（CI）。
 */
export const CN_OFFSET_MS = 8 * 3600 * 1000;

export const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;

export interface CalendarDay {
  /** 北京时间自然日 key："YYYY-MM-DD"（与 chinaDayKey 输出同格式，用于分组） */
  key: string;
  /** 日号 1..31（展示用） */
  date: number;
  /** 星期标签（周一..周日，展示用） */
  weekdayLabel: string;
  /** 月视图：是否属于当前月（相邻月补位日为 false，用于弱化展示） */
  inMonth: boolean;
  /** 是否为今天（北京时间） */
  isToday: boolean;
  /** 北京 0 点的 Date（UTC 字段 = 北京墙钟） */
  cnMidnight: Date;
}

/** 从「UTC 字段 = 北京墙钟」的 Date 推导自然日 key */
export function keyFromCnMidnight(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 北京时间墙钟字段（UTC 字段读取 = 北京自然日） */
function cnFields(d: Date): { year: number; month: number; date: number; day: number } {
  const cn = new Date(d.getTime() + CN_OFFSET_MS);
  return {
    year: cn.getUTCFullYear(),
    month: cn.getUTCMonth(),
    date: cn.getUTCDate(),
    day: cn.getUTCDay(), // 0=周日 .. 6=周六
  };
}

/** 任意 ISO 字符串 / Date → 北京时间自然日 key；非法输入返回 null（调用方跳过分组） */
export function chinaDayKey(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const cn = new Date(d.getTime() + CN_OFFSET_MS);
  return keyFromCnMidnight(cn);
}

/** 今天（北京时间）的 key；测试可注入 reference 日期 */
export function chinaTodayKey(reference: Date = new Date()): string {
  return chinaDayKey(reference) ?? "";
}

/** 本周 7 天（周一~周日，北京时间自然日） */
export function chinaWeekDays(reference: Date = new Date()): CalendarDay[] {
  const { year, month, date, day } = cnFields(reference);
  const daysSinceMonday = (day + 6) % 7; // 周日(0) → 6，周一(1) → 0
  const todayKey = chinaTodayKey(reference);
  const days: CalendarDay[] = [];
  for (let i = 0; i < 7; i++) {
    const cnMid = new Date(Date.UTC(year, month, date - daysSinceMonday + i));
    const key = keyFromCnMidnight(cnMid);
    days.push({
      key,
      date: cnMid.getUTCDate(),
      weekdayLabel: WEEKDAY_LABELS[i],
      inMonth: cnMid.getUTCMonth() === month,
      isToday: key === todayKey,
      cnMidnight: cnMid,
    });
  }
  return days;
}

/** 本月日历网格（6 行 x 7 列固定；相邻月补位日 inMonth=false） */
export function chinaMonthGrid(reference: Date = new Date()): CalendarDay[][] {
  const { year, month } = cnFields(reference);
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const lead = (firstOfMonth.getUTCDay() + 6) % 7; // 周一开头的补位天数
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const totalCells = lead + daysInMonth;
  const trailing = (7 - (totalCells % 7)) % 7;
  const todayKey = chinaTodayKey(reference);

  const cells: CalendarDay[] = [];
  for (let i = 0; i < totalCells + trailing; i++) {
    const cnMid = new Date(Date.UTC(year, month, 1 - lead + i));
    cells.push({
      key: keyFromCnMidnight(cnMid),
      date: cnMid.getUTCDate(),
      weekdayLabel: WEEKDAY_LABELS[i % 7],
      inMonth: cnMid.getUTCMonth() === month,
      isToday: keyFromCnMidnight(cnMid) === todayKey,
      cnMidnight: cnMid,
    });
  }

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

/** planDate ISO → 北京时间 HH:mm（日历卡片展示用）；非法输入返回占位符 */
export function formatPlanTime(value: Date | string | null | undefined): string {
  if (value == null) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const cn = new Date(d.getTime() + CN_OFFSET_MS);
  const hh = String(cn.getUTCHours()).padStart(2, "0");
  const mm = String(cn.getUTCMinutes()).padStart(2, "0");
  return hh + ":" + mm;
}

/** 按北京时间自然日分组（丢失 key 的行跳过，禁止静默伪造日期） */
export function groupRowsByDayKey<T>(
  rows: T[],
  dayKeyOf: (row: T) => string | null,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = dayKeyOf(row);
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}
