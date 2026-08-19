import { Prisma } from '@prisma/client';

/**
 * GL 手工凭证行校验核心（Sprint 7 Finance，ADR-0035；纯函数 + tx 科目解析）
 * 与自动过账 postGlEntry 校验一致：每行恰一侧 > 0 / 科目存在 fail closed / 借贷平衡。
 */

export interface GlManualLineInput {
  accountCode: string;
  debit?: string;
  credit?: string;
  summary?: string;
}

export interface GlValidatedLine {
  accountId: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  summary?: string | null;
}

/** 解析 + 校验行（每行恰一侧 > 0；科目存在 fail closed）；返回 Prisma create 行数据 */
export async function validateGlLines(
  tx: Prisma.TransactionClient,
  lines: GlManualLineInput[],
): Promise<GlValidatedLine[]> {
  const rows: GlValidatedLine[] = [];
  for (const l of lines) {
    const debit = new Prisma.Decimal(l.debit ?? '0').toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const credit = new Prisma.Decimal(l.credit ?? '0').toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (debit.isNegative() || credit.isNegative()) throw new Error('GL_NEGATIVE_AMOUNT');
    if (debit.gt(0) && credit.gt(0)) throw new Error('GL_BOTH_SIDES');
    if (debit.eq(0) && credit.eq(0)) throw new Error('GL_ZERO_AMOUNT');
    const acc = await tx.glAccount.findFirst({ where: { code: l.accountCode, deletedAt: null }, select: { id: true } });
    if (!acc) throw new Error('GL_ACCOUNT_MISSING:' + l.accountCode);
    rows.push({ accountId: acc.id, debit, credit, summary: l.summary ?? null });
  }
  // 借贷平衡
  const totalDebit = rows.reduce((acc, r) => acc.add(r.debit), new Prisma.Decimal(0));
  const totalCredit = rows.reduce((acc, r) => acc.add(r.credit), new Prisma.Decimal(0));
  if (!totalDebit.eq(totalCredit)) throw new Error('GL_UNBALANCED');
  return rows;
}

/** 校验凭证借贷平衡（已有行）——供 PATCH/POST 复核 */
export function assertGlLinesBalanced(lines: Array<{ debit: Prisma.Decimal; credit: Prisma.Decimal }>): void {
  const totalDebit = lines.reduce((acc, r) => acc.add(r.debit), new Prisma.Decimal(0));
  const totalCredit = lines.reduce((acc, r) => acc.add(r.credit), new Prisma.Decimal(0));
  if (!totalDebit.eq(totalCredit)) throw new Error('GL_UNBALANCED');
}
