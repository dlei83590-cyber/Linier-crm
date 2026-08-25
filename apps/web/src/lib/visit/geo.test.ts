import { describe, it, expect } from 'vitest';
import { haversineMeters, chinaTimeRange } from '@/lib/visit/geo';

describe('visit/geo — 拜访/签到地理与时间范围（Migration 0051）', () => {
  it('Haversine：上海→北京约 1068 km（数量级正确）', () => {
    const d = haversineMeters(31.23, 121.47, 39.9042, 116.4074);
    expect(d).toBeGreaterThan(1_000_000);
    expect(d).toBeLessThan(1_200_000);
  });

  it('Haversine：同点距离为 0；近点（约 15 米）在 500 米半径内', () => {
    expect(haversineMeters(31.23, 121.47, 31.23, 121.47)).toBe(0);
    const near = haversineMeters(31.23, 121.47, 31.2301, 121.4701);
    expect(near).toBeGreaterThan(5);
    expect(near).toBeLessThan(50);
    expect(near).toBeLessThan(500);
  });

  it('chinaTimeRange：week = 北京时间周一 00:00 起 7 天窗口（含日对齐）', () => {
    const { start, end } = chinaTimeRange('week');
    const day = new Date(start.getTime() + 8 * 3600 * 1000).getUTCDay();
    expect(day).toBe(1); // 北京时间周一
    expect((end.getTime() - start.getTime()) / (24 * 3600 * 1000)).toBe(7);
  });

  it('chinaTimeRange：month = 北京时间 1 号 00:00 至下月 1 号 00:00（28~31 天）', () => {
    const { start, end } = chinaTimeRange('month');
    expect(new Date(start.getTime() + 8 * 3600 * 1000).getUTCDate()).toBe(1);
    expect(new Date(end.getTime() + 8 * 3600 * 1000).getUTCDate()).toBe(1);
    const days = (end.getTime() - start.getTime()) / (24 * 3600 * 1000);
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(31);
  });
});
