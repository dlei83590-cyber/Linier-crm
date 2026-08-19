import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission } from '@/lib/api-helpers';
import { ok, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';

export const dynamic = 'force-dynamic';

/** GET /api/supplier-payments/:id（详情含未作废核销行 + 各 Open Item 摘要） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'supplier-payment:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'supplier-payment.get');

  const { id } = await params;
  const payment = await prisma.supplierPayment.findFirst({
    where: { id, deletedAt: null },
    include: {
      supplier: { select: { id: true, code: true, name: true } },
      allocations: {
        where: { deletedAt: null, reversedAt: null },
        orderBy: { allocatedAt: 'desc' },
        include: { apOpenItem: { select: { id: true, openAmount: true, settlementStatus: true } } },
      },
    },
  });
  if (!payment) return failNotFound(ERROR_CODES.NOT_FOUND, '付款单不存在');
  return ok(payment);
}