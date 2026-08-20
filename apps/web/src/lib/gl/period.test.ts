import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { periodKeyOf, businessDayStart, businessDayEnd, toAccountingPeriodKey, toGlPeriodKey, assertPeriodOpen, PERIOD_EXEMPT_SOURCE_TYPES } from '@/lib/gl/period';

/**
 * GL 会计期间工具单测（ADR-0044）
 * 覆盖：Asia/Shanghai 归属月（跨日/跨月边界）、业务日边界（修复 UTC bug）、期间键转换、期间校验 fail-closed（CLOSED/LOCKED/FUTURE/NOT_FOUND/豁免/OPEN 放行）。
 */

function makeTx(periodOverrides: Record<string, unknown> = {}) {
  return {
    accountingPeriod: {
      findFirst: vi.fn().mockResolvedValue({ id: 'p1', periodKey: '202608', status: 'OPEN', ...periodOverrides }),
    },
  } as unknown as Prisma.TransactionClient;
}

describe('periodKeyOf — Asia/Shanghai 归属月', () => {
  it('UTC 08:00 = 当地 16:00 当日归属 202608', () => {
    expect(periodKeyOf(new Date('2026-08-20T08:00:00Z'))).toBe('202608');
  });
  it('UTC 8 月 31 日 17:00 = 当地 9 月 1 日 01:00 → 归属 202609（跨月边界）', () => {
    expect(periodKeyOf(new Date('2026-08-31T17:00:00Z'))).toBe('202609');
  });
  it('UTC 1 月 1 日 01:00 = 当地 1 月 1 日 09:00 → 归属 202601', () => {
    expect(periodKeyOf(new Date('2026-01-01T01:00:00Z'))).toBe('202601');
  });
  it('年末跨年边界：UTC 12/31 17:00 = 当地 1/1 01:00 → 归属次年 01', () => {
    expect(periodKeyOf(new Date('2026-12-31T17:00:00Z'))).toBe('202701');
  });
});

describe('businessDayStart / businessDayEnd — 东八区日边界', () => {
  it('dateFrom 2026-08-01 → UTC 2026-07-31T16:00:00Z（当地 00:00）', () => {
    expect(businessDayStart('2026-08-01').toISOString()).toBe('2026-07-31T16:00:00.000Z');
  });
  it('dateTo 2026-08-01 → UTC 2026-08-01T16:00:00Z（当地 24:00，排他）——修复 UTC bug', () => {
    expect(businessDayEnd('2026-08-01').toISOString()).toBe('2026-08-01T16:00:00.000Z');
  });
  it('dateTo 2026-08-01 覆盖当地 00:00-08:00 段（旧实现 T23:59:59.999Z 会漏）', () => {
    const end = businessDayEnd('2026-08-01');
    const hit = new Date('2026-08-01T00:30:00Z'); // 当地 08:30，8 月 1 日
    expect(hit.getTime() < end.getTime()).toBe(true);
  });
});

describe('periodKey 转换（GlPeriodClose 兼容）', () => {
  it('YYYY-MM → YYYYMM / 反向', () => {
    expect(toAccountingPeriodKey('2026-08')).toBe('202608');
    expect(toGlPeriodKey('202608')).toBe('2026-08');
  });
});

describe('assertPeriodOpen — 期间校验 fail-closed（INV1/INV6）', () => {
  it('OPEN 放行', async () => {
    const r = await assertPeriodOpen(makeTx(), new Date('2026-08-20T08:00:00Z'));
    expect(r.status).toBe('OPEN');
  });
  it('CLOSED → throw GL_PERIOD_CLOSED', async () => {
    await expect(assertPeriodOpen(makeTx({ status: 'CLOSED' }), new Date('2026-08-20T08:00:00Z'))).rejects.toThrow('GL_PERIOD_CLOSED');
  });
  it('LOCKED → throw GL_PERIOD_LOCKED', async () => {
    await expect(assertPeriodOpen(makeTx({ status: 'LOCKED' }), new Date('2026-08-20T08:00:00Z'))).rejects.toThrow('GL_PERIOD_LOCKED');
  });
  it('无期间行 → throw GL_PERIOD_NOT_FOUND', async () => {
    const tx = makeTx();
    tx.accountingPeriod.findFirst = vi.fn().mockResolvedValue(null);
    await expect(assertPeriodOpen(tx, new Date('2026-08-20T08:00:00Z'))).rejects.toThrow('GL_PERIOD_NOT_FOUND');
  });
  it('未来期间 → throw GL_PERIOD_FUTURE（无论期间行状态）', async () => {
    await expect(assertPeriodOpen(makeTx(), new Date('2099-01-01T00:00:00Z'))).rejects.toThrow('GL_PERIOD_FUTURE');
  });
  it('系统凭证豁免：PERIOD_CLOSE / PERIOD_CLOSE_REVERSAL 直接返回 EXEMPT', async () => {
    expect(PERIOD_EXEMPT_SOURCE_TYPES.has('PERIOD_CLOSE')).toBe(true);
    expect(PERIOD_EXEMPT_SOURCE_TYPES.has('PERIOD_CLOSE_REVERSAL')).toBe(true);
    const r = await assertPeriodOpen(makeTx(), new Date('2026-08-20T08:00:00Z'), 'PERIOD_CLOSE');
    expect(r.status).toBe('EXEMPT');
  });
  it('业务凭证（MANUAL）无豁免：缺失期间行仍拒绝', async () => {
    const tx = makeTx();
    tx.accountingPeriod.findFirst = vi.fn().mockResolvedValue(null);
    await expect(assertPeriodOpen(tx, new Date('2026-08-20T08:00:00Z'), 'MANUAL')).rejects.toThrow('GL_PERIOD_NOT_FOUND');
  });
});
