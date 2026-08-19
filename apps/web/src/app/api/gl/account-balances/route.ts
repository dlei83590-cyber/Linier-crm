import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission } from '@/lib/api-helpers';
import { ok } from '@/lib/api/response';
import { requestLog } from '@/lib/api/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/gl/account-balances — 科目余额（实时聚合只读，ADR-0034）
 * 期间借贷发生额 + 期末余额（按 direction）。期初余额需累计期初凭证（后续 backlog）。
 * 过滤：dateFrom/dateTo/category。gl:view 权限。
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'gl:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'gl.account-balances');

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get('dateFrom')?.trim();
  const dateTo = searchParams.get('dateTo')?.trim();
  const category = searchParams.get('category')?.trim();

  const entryWhere: Prisma.GlJournalEntryWhereInput = {
    deletedAt: null,
    ...(dateFrom || dateTo
      ? {
          postingDate: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo + 'T23:59:59.999Z') } : {}),
          },
        }
      : {}),
  };

  const accounts = await prisma.glAccount.findMany({
    where: { deletedAt: null, ...(category ? { category: category as never } : {}) },
    select: { id: true, code: true, name: true, category: true, direction: true },
    orderBy: { code: 'asc' },
  });
  if (accounts.length === 0) return ok([]);

  const rows = await prisma.glJournalEntryLine.groupBy({
    by: ['accountId'],
    where: { entry: entryWhere, accountId: { in: accounts.map((a) => a.id) } },
    _sum: { debit: true, credit: true },
  });
  const agg = new Map(rows.map((r) => [r.accountId, r._sum]));

  // 期初余额（dateFrom 前累计；无 dateFrom = 0）——ADR-0036 派生
  const openingRows = dateFrom
    ? await prisma.glJournalEntryLine.groupBy({
        by: ['accountId'],
        where: { entry: { deletedAt: null, postingDate: { lt: new Date(dateFrom) } }, accountId: { in: accounts.map((a) => a.id) } },
        _sum: { debit: true, credit: true },
      })
    : [];
  const openingAgg = new Map(openingRows.map((r) => [r.accountId, r._sum]));

  return ok(
    accounts.map((a) => {
      const sum = agg.get(a.id);
      const debit = sum?.debit ?? new Prisma.Decimal(0);
      const credit = sum?.credit ?? new Prisma.Decimal(0);
      const open = openingAgg.get(a.id);
      const openDebit = open?.debit ?? new Prisma.Decimal(0);
      const openCredit = open?.credit ?? new Prisma.Decimal(0);
      const opening = a.direction === 'DEBIT' ? openDebit.minus(openCredit) : openCredit.minus(openDebit);
      const period = a.direction === 'DEBIT' ? debit.minus(credit) : credit.minus(debit);
      return {
        accountId: a.id,
        code: a.code,
        name: a.name,
        category: a.category,
        direction: a.direction,
        openingBalance: opening.toFixed(2),
        periodDebit: debit.toFixed(2),
        periodCredit: credit.toFixed(2),
        closingBalance: opening.add(period).toFixed(2),
      };
    }),
  );
}