import { Prisma } from '@prisma/client';
import { toAccountingPeriodKey, currentPeriodKey } from '@/lib/gl/period';
import { nextVoucherNo } from '@/lib/gl/voucher-number';

/**
 * GL 期末结转（Sprint 7 Finance，ADR-0036）
 * 结转规则：REVENUE 科目贷方净额 → 借 REVENUE / 贷 本年利润(4103)；EXPENSE 科目借方净额 → 借 本年利润 / 贷 EXPENSE。
 * 防重复：GlPeriodClose.periodKey @unique（同期间只允许一次）；结转凭证 sourceType=PERIOD_CLOSE, sourceId=periodKey。
 * 调用方必须已处于 prisma.$transaction 内。
 */

export type PeriodCloseResult =
  | { ok: true; periodKey: string; journalEntryId: string; voucherNo: string | null; revenueNet: string; expenseNet: string; profit: string }
  | { ok: false; code: string; message: string; httpStatus: number };

/** 本年利润科目 code（EQUITY，期末结转目标） */
export const RETAINED_EARNINGS_CODE = '4103';

/** 期初余额（截至 dateFrom 前）与期末余额（截至 dateTo）聚合——实时派生（ADR-0036） */
export async function computeBalancesWithOpening(
  tx: Prisma.TransactionClient,
  accountId: string,
  dateFrom?: Date,
  dateTo?: Date,
): Promise<{ openingBalance: Prisma.Decimal; periodDebit: Prisma.Decimal; periodCredit: Prisma.Decimal; closingBalance: Prisma.Decimal; direction: string }> {
  const account = await tx.glAccount.findFirst({ where: { id: accountId, deletedAt: null }, select: { direction: true } });
  const direction = account?.direction ?? 'DEBIT';

  // 期初：postingDate < dateFrom（无 dateFrom = 0）
  let opening = new Prisma.Decimal(0);
  if (dateFrom) {
    const before = await tx.glJournalEntryLine.aggregate({
      where: { entry: { deletedAt: null, postingDate: { lt: dateFrom } }, accountId },
      _sum: { debit: true, credit: true },
    });
    const db = before._sum.debit ?? new Prisma.Decimal(0);
    const cr = before._sum.credit ?? new Prisma.Decimal(0);
    opening = direction === 'DEBIT' ? db.minus(cr) : cr.minus(db);
  }

  // 期间：dateFrom ≤ postingDate ≤ dateTo
  const period = await tx.glJournalEntryLine.aggregate({
    where: {
      entry: {
        deletedAt: null,
        ...(dateFrom || dateTo
          ? { postingDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } }
          : {}),
      },
      accountId,
    },
    _sum: { debit: true, credit: true },
  });
  const periodDebit = period._sum.debit ?? new Prisma.Decimal(0);
  const periodCredit = period._sum.credit ?? new Prisma.Decimal(0);
  const signed = direction === 'DEBIT' ? periodDebit.minus(periodCredit) : periodCredit.minus(periodDebit);

  return { openingBalance: opening, periodDebit, periodCredit, closingBalance: opening.add(signed), direction };
}

/** 期末结转：收入/费用 → 本年利润（同事务生成结转凭证 + GlPeriodClose） */

/** 期间重开：红字冲销结转凭证 + 删除 GlPeriodClose（ADR-0037；同事务；借贷平衡数学保证） */
export async function reopenPeriod(
  tx: Prisma.TransactionClient,
  params: { periodCloseId: string; actorId?: string | null },
): Promise<PeriodCloseResult> {
  const close = await tx.glPeriodClose.findFirst({
    where: { id: params.periodCloseId },
    include: { journalEntry: { include: { lines: { select: { accountId: true, debit: true, credit: true, summary: true } } } } },
  });
  if (!close) {
    return { ok: false, code: 'GL_PERIOD_NOT_CLOSED', message: '该期间未结转或已重开（无结转记录）', httpStatus: 409 };
  }
  const original = close.journalEntry;
  if (!original || original.lines.length === 0) {
    return { ok: false, code: 'GL_REOPEN_NO_SOURCE', message: '结转凭证无分录，无法冲销', httpStatus: 409 };
  }

  // 红字冲销：逐行反向（debit↔credit）
  const reversalLines = original.lines.map((l) => ({
    accountId: l.accountId,
    debit: l.credit,
    credit: l.debit,
    summary: '冲销结转：' + (l.summary ?? ''),
  }));
  // 借贷平衡（数学保证：反向行 Σdebit' = Σcredit 原 = Σdebit 原 = Σcredit'）
  {
    const sumD = reversalLines.reduce((acc, l) => acc.add(l.debit), new Prisma.Decimal(0));
    const sumC = reversalLines.reduce((acc, l) => acc.add(l.credit), new Prisma.Decimal(0));
    if (!sumD.eq(sumC)) {
      return { ok: false, code: 'GL_UNBALANCED', message: '冲销分录借贷不平衡（内部错误）', httpStatus: 500 };
    }
  }

  // 取号（ADR-0044：冲销凭证 = 当期 TRANSFER；格式 转YYYYMM-0001）
  const voucherNo = await nextVoucherNo(tx, { periodKey: currentPeriodKey(), voucherType: 'TRANSFER' });

  // 冲销凭证（sourceType=PERIOD_CLOSE_REVERSAL, sourceId 唯一；期间校验豁免白名单 PERIOD_CLOSE_REVERSAL）
  const reversal = await tx.glJournalEntry.create({
    data: {
      voucherNo,
      postingDate: new Date(),
      status: 'POSTED',
      voucherType: 'TRANSFER',
      attachmentCount: 0,
      sourceType: 'PERIOD_CLOSE_REVERSAL',
      sourceId: `${close.periodKey}|reopen|${Date.now()}`,
      summary: '冲销结转：' + close.periodKey,
      createdById: params.actorId ?? null,
      postedById: params.actorId ?? null,
      postedAt: new Date(),
      lines: { create: reversalLines },
    },
  });

  // 删除 GlPeriodClose（允许重新结转）
  await tx.glPeriodClose.delete({ where: { id: params.periodCloseId } });

  // AccountingPeriod 状态联动（ADR-0044，INV2）：CLOSED → OPEN + 清引用（同事务）
  await tx.accountingPeriod.updateMany({
    where: { periodKey: toAccountingPeriodKey(close.periodKey) },
    data: { status: 'OPEN', periodCloseId: null, closedById: null, closedAt: null },
  });

  return {
    ok: true,
    periodKey: close.periodKey,
    journalEntryId: reversal.id,
    voucherNo,
    revenueNet: '0.00',
    expenseNet: '0.00',
    profit: '0.00',
  };
}

export async function closePeriod(
  tx: Prisma.TransactionClient,
  params: { periodKey: string; actorId?: string | null },
): Promise<PeriodCloseResult> {
  const existing = await tx.glPeriodClose.findFirst({ where: { periodKey: params.periodKey } });
  if (existing) {
    return { ok: false, code: 'GL_PERIOD_ALREADY_CLOSED', message: '该期间已结转（periodKey 唯一防重复）', httpStatus: 409 };
  }
  // AccountingPeriod 期间校验（ADR-0044，INV8）：仅 OPEN 可结转；LOCKED 拒绝
  const accPeriodKey = toAccountingPeriodKey(params.periodKey);
  const accPeriod = await tx.accountingPeriod.findFirst({ where: { periodKey: accPeriodKey } });
  if (!accPeriod) {
    return { ok: false, code: 'GL_PERIOD_NOT_FOUND', message: '会计期间不存在（' + accPeriodKey + '）——请先运行期间 backfill 初始化', httpStatus: 409 };
  }
  if (accPeriod.status !== 'OPEN') {
    return { ok: false, code: accPeriod.status === 'LOCKED' ? 'GL_PERIOD_LOCKED' : 'GL_PERIOD_ALREADY_CLOSED', message: '仅 OPEN 期间可结转（当前 ' + accPeriod.status + '）', httpStatus: 409 };
  }

  // 期间范围：periodKey "YYYY-MM"
  const [yearStr, monthStr] = params.periodKey.split('-');
  if (!yearStr || !monthStr || !/^\d{4}$/.test(yearStr) || !/^\d{2}$/.test(monthStr)) {
    return { ok: false, code: 'GL_PERIOD_INVALID', message: '期间格式必须为 YYYY-MM', httpStatus: 400 };
  }
  const periodStart = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, 1));
  const periodEnd = new Date(Date.UTC(Number(yearStr), Number(monthStr), 0, 23, 59, 59, 999));

  // 聚合该期间已 POSTED 凭证的 REVENUE/EXPENSE 科目净额（按方向：REVENUE=CREDIT 方向 credit-debit；EXPENSE=DEBIT 方向 debit-credit）
  const accounts = await tx.glAccount.findMany({
    where: { deletedAt: null, category: { in: ['REVENUE', 'EXPENSE'] } },
    select: { id: true, code: true, name: true, category: true, direction: true },
  });
  const lines = await tx.glJournalEntryLine.findMany({
    where: { entry: { deletedAt: null, status: 'POSTED', postingDate: { gte: periodStart, lte: periodEnd } } },
    select: { accountId: true, debit: true, credit: true },
  });
  const agg = new Map<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>();
  for (const l of lines) {
    const cur = agg.get(l.accountId) ?? { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) };
    cur.debit = cur.debit.add(l.debit);
    cur.credit = cur.credit.add(l.credit);
    agg.set(l.accountId, cur);
  }

  let revenueNet = new Prisma.Decimal(0); // 收入贷方净额合计
  let expenseNet = new Prisma.Decimal(0); // 费用借方净额合计
  const reversalLines: Array<{ accountCode: string; debit: string; credit: string; summary: string }> = [];
  for (const a of accounts) {
    const sum = agg.get(a.id);
    if (!sum) continue;
    if (a.category === 'REVENUE') {
      const net = sum.credit.minus(sum.debit);
      if (net.gt(0)) {
        revenueNet = revenueNet.add(net);
        reversalLines.push({ accountCode: a.code, debit: net.toFixed(2), credit: '0', summary: '结转收入：' + a.name });
      }
    } else if (a.category === 'EXPENSE') {
      const net = sum.debit.minus(sum.credit);
      if (net.gt(0)) {
        expenseNet = expenseNet.add(net);
        reversalLines.push({ accountCode: a.code, debit: '0', credit: net.toFixed(2), summary: '结转费用：' + a.name });
      }
    }
  }

  // 本年利润 = 收入 - 费用（差额入 4103，借贷平衡由构造保证）：
  // 借 REVENUE(revenueNet) + 借 4103(expenseNet) = 贷 EXPENSE(expenseNet) + 贷 4103(revenueNet)
  // → 简化：reversalLines 已含 借 REVENUE / 贷 EXPENSE；4103 只需净额行（retained = revenueNet - expenseNet）
  const retained = revenueNet.minus(expenseNet);
  const retainedAbs = retained.abs();
  const linesData: Array<{ accountCode: string; debit: string; credit: string; summary: string }> = [];
  if (retained.gt(0) && retainedAbs.gt(0)) {
    linesData.push({ accountCode: RETAINED_EARNINGS_CODE, debit: '0', credit: retainedAbs.toFixed(2), summary: '结转本年利润（收入-费用净额）' });
  } else if (retained.lt(0) && retainedAbs.gt(0)) {
    linesData.push({ accountCode: RETAINED_EARNINGS_CODE, debit: retainedAbs.toFixed(2), credit: '0', summary: '结转本年利润（收入-费用净额）' });
  }
  const allLines = [...reversalLines, ...linesData];

  // 借贷平衡断言（构造保证：Σ借 = Σ贷）
  {
    const sumD = allLines.reduce((acc, l) => acc.add(new Prisma.Decimal(l.debit)), new Prisma.Decimal(0));
    const sumC = allLines.reduce((acc, l) => acc.add(new Prisma.Decimal(l.credit)), new Prisma.Decimal(0));
    if (!sumD.eq(sumC)) {
      return { ok: false, code: 'GL_UNBALANCED', message: '结转分录借贷不平衡（内部错误）', httpStatus: 500 };
    }
  }

  if (allLines.length === 0) {
    return { ok: false, code: 'GL_PERIOD_NO_ACTIVITY', message: '该期间无收入/费用凭证，无需结转', httpStatus: 409 };
  }

  // 借贷平衡校验（结转引擎保证：Σ借(收入) + 借(费用结转) + 借(净额) = Σ贷(4103) + 贷(费用)… 精确）
  // 更稳妥：直接构造平衡凭证——借 REVENUE 合计 + 借 4103(expenseNet) = 贷 4103(revenueNet) + 贷 EXPENSE 合计
  // 简化实现：以上 allLines 已经数学平衡（revenueNet 借 = 4103 贷；expenseNet 贷 = 4103 借；retained 差额在 4103 净额行）

  // 取号（ADR-0044：结转凭证 = 结转期间 TRANSFER；格式 转YYYYMM-0001）
  const voucherNo = await nextVoucherNo(tx, { periodKey: accPeriodKey, voucherType: 'TRANSFER' });

  // 创建结转凭证（sourceType=PERIOD_CLOSE, sourceId=periodKey 幂等；期间校验豁免白名单 PERIOD_CLOSE）
  const entry = await tx.glJournalEntry.create({
    data: {
      voucherNo,
      postingDate: periodEnd,
      status: 'POSTED',
      voucherType: 'TRANSFER',
      attachmentCount: 0,
      sourceType: 'PERIOD_CLOSE',
      sourceId: params.periodKey,
      summary: '期末结转：' + params.periodKey,
      createdById: params.actorId ?? null,
      postedById: params.actorId ?? null,
      postedAt: new Date(),
      lines: { create: await Promise.all(allLines.map(async (l) => {
        const acc = await tx.glAccount.findFirst({ where: { code: l.accountCode, deletedAt: null }, select: { id: true } });
        if (!acc) throw new Error('GL_ACCOUNT_MISSING:' + l.accountCode);
        return { accountId: acc.id, debit: new Prisma.Decimal(l.debit), credit: new Prisma.Decimal(l.credit), summary: l.summary };
      })) },
    },
  });

  // GlPeriodClose（防重复月结）
  const periodClose = await tx.glPeriodClose.create({
    data: { periodKey: params.periodKey, journalEntryId: entry.id, closedById: params.actorId ?? null },
  });

  // AccountingPeriod 状态联动（ADR-0044，INV2）：OPEN → CLOSED + periodCloseId（同事务）
  await tx.accountingPeriod.updateMany({
    where: { periodKey: accPeriodKey },
    data: { status: 'CLOSED', periodCloseId: periodClose.id, closedById: params.actorId ?? null, closedAt: new Date() },
  });

  return {
    ok: true,
    periodKey: params.periodKey,
    journalEntryId: entry.id,
    voucherNo,
    revenueNet: revenueNet.toFixed(2),
    expenseNet: expenseNet.toFixed(2),
    profit: retained.toFixed(2),
  };
}