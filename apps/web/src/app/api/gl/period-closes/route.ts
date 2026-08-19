import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission } from '@/lib/api-helpers';
import { ok } from '@/lib/api/response';
import { requestLog } from '@/lib/api/logger';

export const dynamic = 'force-dynamic';

/** GET /api/gl/period-closes — 已结转期间列表（ADR-0036；gl:view） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'gl:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'gl.period-close.list');

  const rows = await prisma.glPeriodClose.findMany({
    orderBy: { periodKey: 'desc' },
    include: { journalEntry: { select: { id: true, voucherNo: true } } },
  });
  return ok(rows);
}
