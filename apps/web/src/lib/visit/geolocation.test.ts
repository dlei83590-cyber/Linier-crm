import { describe, it, expect } from 'vitest';
import { GEOLOCATION_OPTIONS, geolocationErrorMessage } from '@/lib/visit/geolocation';

describe('visit/geolocation — 浏览器定位错误反馈（FRT-04，禁止静默失败）', () => {
  it('定位选项：15s 超时、不缓存旧位置、高精度（签到需真实当前位置）', () => {
    expect(GEOLOCATION_OPTIONS.timeout).toBe(15000);
    expect(GEOLOCATION_OPTIONS.maximumAge).toBe(0);
    expect(GEOLOCATION_OPTIONS.enableHighAccuracy).toBe(true);
  });

  it('PERMISSION_DENIED(1) → 明确提示权限被拒（含浏览器授权指引）', () => {
    expect(geolocationErrorMessage(1)).toContain('权限');
  });

  it('POSITION_UNAVAILABLE(2) / TIMEOUT(3) → 区分信号不可用与超时', () => {
    expect(geolocationErrorMessage(2)).toContain('无法获取');
    expect(geolocationErrorMessage(3)).toContain('超时');
  });

  it('未知/缺失 code → 兜底文案（不静默空串）', () => {
    expect(geolocationErrorMessage(undefined)).toBe('定位失败，请重试');
    expect(geolocationErrorMessage(99)).toContain('定位失败');
  });
});
