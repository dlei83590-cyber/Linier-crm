import { Prisma } from '@prisma/client';

/**
 * GL 会计期间 / 业务日工具（ADR-0044）
 * - 业务日 = Asia/Shanghai（东八区）：DB 存 UTC，期间归属/日边界一律经本工具解析，禁止再拼 T23:59:59.999Z
 * - periodKey 格式：AccountingPeriod 'YYYYMM'；GlPeriodClose 'YYYY-MM'（转换函数兼容）
 * - assertPeriodOpen：过账期间校验（fail closed），系统凭证（PERIOD_CLOSE/PERIOD_CLOSE_REVERSAL）豁免
 */

export const BUSINESS_TIMEZONE_OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Shanghai = UTC+8

/** Date → 'YYYYMM'（Asia/Shanghai 归属月） */
export function periodKeyOf(date: Date): string {
  const d = new Date(date.getTime() + BUSINESS_TIMEZONE_OFFSET_MS);
  return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0');
}

/** 当前 Asia/Shanghai 期间 'YYYYMM' */
export function currentPeriodKey(): string {
  return periodKeyOf(new Date());
}

/** 'YYYY-MM' → 'YYYYMM'（GlPeriodClose 兼容） */
export function toAccountingPeriodKey(glKey: string): string {
  return glKey.replace('-', '');
}

/** 'YYYYMM' → 'YYYY-MM' */
export function toGlPeriodKey(accKey: string): string {
  return accKey.slice(0, 4) + '-' + accKey.slice(4);
}

/** 期间边界（UTC 时刻）：start = 当月 1 日 00:00 CST；end = 次月 1 日 00:00 CST（排他） */
export function periodBoundaries(periodKey: string): { start: Date; end: Date } {
  const year = Number(periodKey.slice(0, 4));
  const month = Number(periodKey.slice(4, 6));
  const start = new Date(Date.UTC(year, month - 1, 1) - BUSINESS_TIMEZONE_OFFSET_MS);
  const end = new Date(Date.UTC(year, month, 1) - BUSINESS_TIMEZONE_OFFSET_MS);
  return { start, end };
}

/** 业务日（'YYYY-MM-DD'）起始 UTC 时刻 = 当日 00:00 CST */
export function businessDayStart(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - BUSINESS_TIMEZONE_OFFSET_MS);
}

/** 业务日（'YYYY-MM-DD'）结束 UTC 时刻（排他）= 次日 00:00 CST（修复 dateTo + 'T23:59:59.999Z' UTC bug） */
export function businessDayEnd(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1) - BUSINESS_TIMEZONE_OFFSET_MS);
}

/** 系统凭证豁免白名单（INV6）：期间状态机自身产物，过账期间由 close/reopen 事务决定，豁免普通期间校验防自锁 */
export const PERIOD_EXEMPT_SOURCE_TYPES = new Set(['PERIOD_CLOSE', 'PERIOD_CLOSE_REVERSAL']);

export interface PeriodAssertResult {
  periodKey: string;
  status: string;
}

/**
 * 期间校验（fail closed，INV1）：
 * 1) 幂等命中由调用方先行短路（本函数不处理幂等）；
 * 2) 未来期间 → throw 'GL_PERIOD_FUTURE'；3) 无期间行 → throw 'GL_PERIOD_NOT_FOUND'；
 * 4) CLOSED/LOCKED → throw 'GL_PERIOD_CLOSED' / 'GL_PERIOD_LOCKED'；5) OPEN 放行。
 * 系统凭证（PERIOD_CLOSE/PERIOD_CLOSE_REVERSAL）豁免（INV6）。
 */
export async function assertPeriodOpen(
  tx: Prisma.TransactionClient,
  postingDate: Date,
  sourceType?: string | null,
): Promise<PeriodAssertResult> {
  const periodKey = periodKeyOf(postingDate);
  if (sourceType && PERIOD_EXEMPT_SOURCE_TYPES.has(sourceType)) {
    return { periodKey, status: 'EXEMPT' };
  }
  if (periodKey > currentPeriodKey()) throw new Error('GL_PERIOD_FUTURE');
  const period = await tx.accountingPeriod.findFirst({ where: { periodKey } });
  if (!period) throw new Error('GL_PERIOD_NOT_FOUND');
  if (period.status !== 'OPEN') {
    throw new Error(period.status === 'LOCKED' ? 'GL_PERIOD_LOCKED' : 'GL_PERIOD_CLOSED');
  }
  return { periodKey, status: period.status };
}
