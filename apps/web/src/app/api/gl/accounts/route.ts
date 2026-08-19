import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission } from '@/lib/api-helpers';
import { ok } from '@/lib/api/response';
import { requestLog } from '@/lib/api/logger';

export const dynamic = 'force-dynamic';

/** GET /api/gl/accounts — 会计科目表（只读主数据；Sprint 7 GL，ADR-0033；gl:view 权限） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'gl:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'gl.account.list');

  const category = request.nextUrl.searchParams.get('category')?.trim();
  const accounts = await prisma.glAccount.findMany({
    where: {
      deletedAt: null,
      ...(category ? { category: category as never } : {}),
    },
    orderBy: { code: 'asc' },
  });
  return ok(accounts);
}
