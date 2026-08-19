import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission } from '@/lib/api-helpers';
import { ok } from '@/lib/api/response';
import { requestLog } from '@/lib/api/logger';
import { computeProfitStatement } from '@/lib/gl/balances';

export const dynamic = 'force-dynamic';

/**
 * GET /api/gl/profit-statement — 利润表（简化，实时聚合只读，ADR-0034）
 * 期间：收入（REVENUE 贷方净额）− 成本/费用（EXPENSE 借方净额）= 利润。
 * 过滤：dateFrom/dateTo。gl:view 权限。
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'gl:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'gl.profit-statement');

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get('dateFrom')?.trim();
  const dateTo = searchParams.get('dateTo')?.trim();

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
    where: { deletedAt: null, category: { in: ['REVENUE', 'EXPENSE'] } },
    select: { id: true, code: true, name: true, category: true, direction: true },
    orderBy: { code: 'asc' },
  });
  if (accounts.length === 0) return ok({ revenue: 0, expense: 0, profit: '0.00', lines: [] });

  const rows = await prisma.glJournalEntryLine.groupBy({
    by: ['accountId'],
    where: { entry: entryWhere, accountId: { in: accounts.map((a) => a.id) } },
    _sum: { debit: true, credit: true },
  });
  const agg = new Map(rows.map((r) => [r.accountId, r._sum]));

  const result = computeProfitStatement(
    accounts.map((a) => {
      const sum = agg.get(a.id);
      return {
        accountId: a.id,
        code: a.code,
        name: a.name,
        category: a.category,
        direction: a.direction as 'DEBIT' | 'CREDIT',
        debit: sum?.debit ?? new Prisma.Decimal(0),
        credit: sum?.credit ?? new Prisma.Decimal(0),
      };
    }),
  );
  return ok(result);
}