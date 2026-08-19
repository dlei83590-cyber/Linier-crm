import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission } from '@/lib/api-helpers';
import { ok, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';

export const dynamic = 'force-dynamic';

/** GET /api/gl/journal-entries/:id — 记账凭证详情（含行 + 科目；Sprint 7 GL，ADR-0033；gl:view） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'gl:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'gl.journal-entry.get');

  const { id } = await params;
  const entry = await prisma.glJournalEntry.findFirst({
    where: { id, deletedAt: null },
    include: {
      lines: {
        include: { account: { select: { id: true, code: true, name: true, category: true, direction: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!entry) return failNotFound(ERROR_CODES.NOT_FOUND, '记账凭证不存在');
  return ok(entry);
}
