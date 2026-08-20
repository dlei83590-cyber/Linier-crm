/**
 * 会计期间 backfill（ADR-0044；部署期执行一次，幂等可重跑）
 * 用法：tsx scripts/backfill-accounting-periods.ts [--from YYYY-MM]
 * 逻辑：
 *   1) 从 --from（默认 MIN(GlJournalEntry.postingDate) 归属月，兜底 2026-01）至当月（Asia/Shanghai）逐月 upsert AccountingPeriod；
 *   2) status 由 GlPeriodClose 存在性决定（存在 → CLOSED + periodCloseId；否则 OPEN）；
 *   3) 停用旧全局 JRN 序列行（isActive=false，历史凭证不重编号）；
 *   4) 未来月份不建档（未来期间过账由 GL_PERIOD_FUTURE / GL_PERIOD_NOT_FOUND 双防线拦截）。
 * 不运行于 CI（部署脚本）；本地禁止执行（CI-First）。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Shanghai

function periodKeyOf(date: Date): string {
  const d = new Date(date.getTime() + TZ_OFFSET_MS);
  return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0');
}

function monthStart(periodKey: string): Date {
  const y = Number(periodKey.slice(0, 4));
  const m = Number(periodKey.slice(4, 6));
  return new Date(Date.UTC(y, m - 1, 1) - TZ_OFFSET_MS); // 当地 1 日 00:00
}

function monthEndExclusive(periodKey: string): Date {
  const y = Number(periodKey.slice(0, 4));
  const m = Number(periodKey.slice(4, 6));
  return new Date(Date.UTC(y, m, 1) - TZ_OFFSET_MS); // 次月 1 日 00:00（排他）
}

function toGlKey(accKey: string): string {
  return accKey.slice(0, 4) + '-' + accKey.slice(4);
}

async function main() {
  const fromArg = process.argv.indexOf('--from');
  const fromInput = fromArg >= 0 ? process.argv[fromArg + 1] : null;

  let fromKey: string;
  if (fromInput) {
    fromKey = fromInput.replace('-', '');
  } else {
    const first = await prisma.glJournalEntry.findFirst({ orderBy: { postingDate: 'asc' }, select: { postingDate: true } });
    fromKey = first ? periodKeyOf(first.postingDate) : '202601';
  }
  const nowKey = periodKeyOf(new Date());

  // 已结转期间集合（GlPeriodClose → CLOSED）
  const closes = await prisma.glPeriodClose.findMany({ select: { periodKey: true, id: true } });
  const closedByGlKey = new Map(closes.map((c) => [c.periodKey.replace('-', ''), c.id]));

  let created = 0;
  let updated = 0;
  // 逐月推进（YYYYMM 数值递增）
  let cur = Number(fromKey);
  const now = Number(nowKey);
  while (cur <= now) {
    const key = String(cur);
    const glKey = toGlKey(key);
    const closeId = closedByGlKey.get(key) ?? null;
    const start = monthStart(key);
    const end = monthEndExclusive(key);
    const existing = await prisma.accountingPeriod.findUnique({ where: { periodKey: key } });
    const data = {
      fiscalYear: Number(key.slice(0, 4)),
      startDate: start,
      endDate: end,
      status: closeId ? 'CLOSED' : 'OPEN',
      periodCloseId: closeId,
      closedById: null,
      closedAt: closeId ? new Date() : null,
    };
    if (existing) {
      await prisma.accountingPeriod.update({ where: { periodKey: key }, data });
      updated++;
    } else {
      await prisma.accountingPeriod.create({ data: { periodKey: key, ...data } });
      created++;
    }
    // 推进到下月
    const y = Math.floor(cur / 100);
    const m = cur % 100;
    cur = m === 12 ? (y + 1) * 100 + 1 : cur + 1;
  }

  // 停用旧全局 JRN 序列（历史凭证不重编号）
  const oldJrn = await prisma.documentSequence.findMany({ where: { code: 'JRN', isActive: true } });
  for (const s of oldJrn) {
    await prisma.documentSequence.update({ where: { id: s.id }, data: { isActive: false } });
  }

  console.log(`[backfill-accounting-periods] ${fromKey} → ${nowKey}：created=${created} updated=${updated}；旧 JRN 序列停用=${oldJrn.length}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('[backfill-accounting-periods] FAILED', e);
  process.exit(1);
});
