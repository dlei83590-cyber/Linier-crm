import { Prisma } from '@prisma/client';

/**
 * GL 余额/试算/利润聚合核心（Sprint 7 Finance，ADR-0034；纯函数可单测）
 * 余额 = 派生投影（事实源 = GlJournalEntry 不可变凭证）；按 GlAccount.direction 决定余额方向。
 */

export interface GlAggLineInput {
  accountId: string;
  code: string;
  name: string;
  category: string;
  direction: 'DEBIT' | 'CREDIT';
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
}

export interface GlAggLineOutput {
  accountId: string;
  code: string;
  name: string;
  category: string;
  direction: 'DEBIT' | 'CREDIT';
  debit: string;
  credit: string;
  balance: string;
}

/** 试算平衡：按科目借贷发生额 + 余额（DEBIT 科目 balance = debit−credit；CREDIT 科目 = credit−debit）；返回 Σ 校验 */
export function computeTrialBalance(lines: GlAggLineInput[]): {
  lines: GlAggLineOutput[];
  totals: { debit: string; credit: string };
  inBalance: boolean;
} {
  let totalDebit = new Prisma.Decimal(0);
  let totalCredit = new Prisma.Decimal(0);
  const out = lines.map((a) => {
    totalDebit = totalDebit.add(a.debit);
    totalCredit = totalCredit.add(a.credit);
    const balance = a.direction === 'DEBIT' ? a.debit.minus(a.credit) : a.credit.minus(a.debit);
    return {
      accountId: a.accountId,
      code: a.code,
      name: a.name,
      category: a.category,
      direction: a.direction,
      debit: a.debit.toFixed(2),
      credit: a.credit.toFixed(2),
      balance: balance.toFixed(2),
    };
  });
  return {
    lines: out,
    totals: { debit: totalDebit.toFixed(2), credit: totalCredit.toFixed(2) },
    inBalance: totalDebit.eq(totalCredit),
  };
}

/** 利润表（简化）：REVENUE（CREDIT 方向）贷方净额 − EXPENSE（DEBIT 方向）借方净额 = 利润 */
export function computeProfitStatement(lines: GlAggLineInput[]): {
  revenue: string;
  expense: string;
  profit: string;
  lines: Array<{ code: string; name: string; category: string; net: string }>;
} {
  let revenue = new Prisma.Decimal(0);
  let expense = new Prisma.Decimal(0);
  const out = lines.map((a) => {
    const net = a.direction === 'DEBIT' ? a.debit.minus(a.credit) : a.credit.minus(a.debit);
    if (a.category === 'REVENUE') revenue = revenue.add(net);
    else if (a.category === 'EXPENSE') expense = expense.add(net);
    return { code: a.code, name: a.name, category: a.category, net: net.toFixed(2) };
  });
  const profitValue = revenue.minus(expense);
  return { revenue: revenue.toFixed(2), expense: expense.toFixed(2), profit: profitValue.toFixed(2), lines: out };
}
