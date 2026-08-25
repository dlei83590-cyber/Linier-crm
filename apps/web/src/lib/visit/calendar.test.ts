import { describe, it, expect } from "vitest";
import {
  chinaDayKey,
  chinaTodayKey,
  chinaWeekDays,
  chinaMonthGrid,
  groupRowsByDayKey,
  keyFromCnMidnight,
  formatPlanTime,
  CN_OFFSET_MS,
} from "@/lib/visit/calendar";

/** 构造「北京时间墙钟」Date：参数为北京自然日（UTC 字段=北京） */
function cnDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}

describe("visit calendar（UI-05 周/月视图，北京时间自然日）", () => {
  describe("chinaDayKey", () => {
    it("UTC 输入换算为北京时间自然日 key（+8 小时进位到次日）", () => {
      // 2026-09-07 16:30 UTC + 8h = 北京 2026-09-08 00:30 → key 2026-09-08
      expect(chinaDayKey("2026-09-07T16:30:00.000Z")).toBe("2026-09-08");
      // 北京中午 = UTC 凌晨 04:00 仍落在同日
      expect(chinaDayKey("2026-09-08T04:00:00.000Z")).toBe("2026-09-08");
    });

    it("北京中午 = UTC 凌晨 04:00 仍落在同日", () => {
      expect(chinaDayKey("2026-09-08T04:00:00.000Z")).toBe("2026-09-08");
    });

    it("非法输入返回 null（调用方跳过分组，禁止伪造日期）", () => {
      expect(chinaDayKey(null)).toBeNull();
      expect(chinaDayKey(undefined)).toBeNull();
      expect(chinaDayKey("not-a-date")).toBeNull();
    });
  });

  describe("chinaWeekDays", () => {
    it("2026-09-09（周三，北京时间）→ 周一 2026-09-07 ~ 周日 2026-09-13", () => {
      // 北京 2026-09-09 12:00 = UTC 2026-09-09 04:00
      const reference = new Date("2026-09-09T04:00:00.000Z");
      const days = chinaWeekDays(reference);
      expect(days).toHaveLength(7);
      expect(days[0].key).toBe("2026-09-07");
      expect(days[0].weekdayLabel).toBe("周一");
      expect(days[6].key).toBe("2026-09-13");
      expect(days[6].weekdayLabel).toBe("周日");
      // 周三（index 2）应为今天
      expect(days[2].isToday).toBe(true);
      expect(days[0].isToday).toBe(false);
    });

    it("周日至周一边界：周日 2026-09-13 属于 09-07~09-13 那一周，不跨到下周", () => {
      const reference = new Date("2026-09-13T04:00:00.000Z"); // 北京 9/13 周日
      const days = chinaWeekDays(reference);
      expect(days[6].key).toBe("2026-09-13");
      expect(days[6].isToday).toBe(true);
      expect(days[0].key).toBe("2026-09-07");
    });

    it("跨月周：2026-09-30（周三）→ 周一 2026-09-28 ~ 周日 2026-10-04（Date.UTC 自动进位）", () => {
      const reference = new Date("2026-09-30T04:00:00.000Z");
      const days = chinaWeekDays(reference);
      expect(days[0].key).toBe("2026-09-28");
      expect(days[6].key).toBe("2026-10-04");
    });
  });

  describe("chinaMonthGrid", () => {
    it("2026 年 9 月：网格 5 行 x 7 列，覆盖 8/31 ~ 10/4，今天 9/9 高亮", () => {
      const reference = new Date("2026-09-09T04:00:00.000Z");
      const weeks = chinaMonthGrid(reference);
      expect(weeks.length).toBe(5);
      for (const week of weeks) expect(week).toHaveLength(7);
      const flat = weeks.flat();
      expect(flat[0].key).toBe("2026-08-31"); // 9/1 是周二 → 周一补位 8/31
      expect(flat[flat.length - 1].key).toBe("2026-10-04");
      // 相邻月补位日 inMonth=false；9 月自然日 inMonth=true
      expect(flat[0].inMonth).toBe(false);
      const sep9 = flat.find((d) => d.key === "2026-09-09");
      expect(sep9?.isToday).toBe(true);
      const sep30 = flat.find((d) => d.key === "2026-09-30");
      expect(sep30?.inMonth).toBe(true);
    });

    it("每月首日必须位于周一开头的正确列（2026-10-01 周四 → 补位 3 天）", () => {
      const reference = new Date("2026-10-15T04:00:00.000Z");
      const weeks = chinaMonthGrid(reference);
      const flat = weeks.flat();
      const oct1 = flat.find((d) => d.key === "2026-10-01");
      expect(oct1?.weekdayLabel).toBe("周四");
      expect(flat[0].key).toBe("2026-09-28"); // 9/28 周一
    });
  });

  describe("groupRowsByDayKey", () => {
    it("按北京时间自然日分组；无效日期行被跳过", () => {
      const rows = [
        { id: "a", planDate: "2026-09-07T16:30:00.000Z" }, // 北京 9/8
        { id: "b", planDate: "2026-09-08T04:00:00.000Z" }, // 北京 9/8
        { id: "c", planDate: "2026-09-09T04:00:00.000Z" }, // 北京 9/9
        { id: "d", planDate: null },
      ];
      const grouped = groupRowsByDayKey(rows, (r) => chinaDayKey(r.planDate));
      expect(grouped.get("2026-09-08")?.map((r) => r.id)).toEqual(["a", "b"]);
      expect(grouped.get("2026-09-09")?.map((r) => r.id)).toEqual(["c"]);
      expect(grouped.has("1970-01-01")).toBe(false);
    });
  });

  it("keyFromCnMidnight 与 chinaDayKey 自洽（cnMidnight 往返）", () => {
    const cnMid = cnDate(2026, 8, 9); // 北京 9/9 0 点
    expect(keyFromCnMidnight(cnMid)).toBe("2026-09-09");
    expect(chinaDayKey(cnMid)).toBe("2026-09-09");
    // cnMidnight.getTime() - CN_OFFSET_MS = UTC 前一天 16:00
    expect(new Date(cnMid.getTime() - CN_OFFSET_MS).toISOString()).toBe("2026-09-08T16:00:00.000Z");
  });

  it("chinaTodayKey 默认取当前时间（北京时间），格式 YYYY-MM-DD", () => {
    const key = chinaTodayKey();
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  describe("formatPlanTime", () => {
    it("UTC 输入按北京时间显示 HH:mm（+8）", () => {
      // 北京 2026-09-09 14:30 = UTC 06:30
      expect(formatPlanTime("2026-09-09T06:30:00.000Z")).toBe("14:30");
      // 北京 2026-09-09 09:05 = UTC 01:05
      expect(formatPlanTime("2026-09-09T01:05:00.000Z")).toBe("09:05");
    });

    it("非法输入返回占位符", () => {
      expect(formatPlanTime(null)).toBe("—");
      expect(formatPlanTime("bad")).toBe("—");
    });
  });
});
