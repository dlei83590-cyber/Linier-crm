import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission } from '@/lib/api-helpers';
import { ok, parsePagination } from '@/lib/api/response';
import { requestLog } from '@/lib/api/logger';
import { businessDayStart, businessDayEnd } from '@/lib/gl/period';

export const dynamic = 'force-dynamic';

/** GET /api/gl/journal-entries — 记账凭证列表（分页 + sourceType/sourceId/status/dateFrom/dateTo 过滤；Sprint 7 GL，ADR-0033；gl:view） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'gl:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'gl.journal-entry.list');

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const sourceType = searchParams.get('sourceType')?.trim();
  const sourceId = searchParams.get('sourceId')?.trim();
  const status = searchParams.get('status')?.trim();
  const dateFrom = searchParams.get('dateFrom')?.trim();
  const dateTo = searchParams.get('dateTo')?.trim();

  const where: Prisma.GlJournalEntryWhereInput = {
    deletedAt: null,
    ...(sourceType ? { sourceType } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(status ? { status } : {}),
    ...(dateFrom || dateTo
      ? {
          postingDate: {
            // Asia/Shanghai 业务日边界（ADR-0044，修复 dateTo UTC 日边界 bug）
            ...(dateFrom ? { gte: businessDayStart(dateFrom) } : {}),
            ...(dateTo ? { lte: businessDayEnd(dateTo) } : {}),
          },
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.glJournalEntry.count({ where }),
    prisma.glJournalEntry.findMany({
      where,
      orderBy: { postingDate: 'desc' },
      skip,
      take,
      include: {
        lines: {
          include: { account: { select: { id: true, code: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    }),
  ]);

  const rows = items.map((e) => ({
    id: e.id,
    voucherNo: e.voucherNo,
    postingDate: e.postingDate,
    status: e.status,
    sourceType: e.sourceType,
    sourceId: e.sourceId,
    summary: e.summary,
    totalDebit: e.lines.reduce((acc, l) => acc.add(l.debit), new Prisma.Decimal(0)).toFixed(2),
    totalCredit: e.lines.reduce((acc, l) => acc.add(l.credit), new Prisma.Decimal(0)).toFixed(2),
    lineCount: e.lines.length,
    lines: e.lines,
  }));

  return ok(rows, { page, pageSize, total });
}