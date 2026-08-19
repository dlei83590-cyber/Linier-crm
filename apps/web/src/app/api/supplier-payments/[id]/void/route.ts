import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';

export const dynamic = 'force-dynamic';

/** POST /api/supplier-payments/:id/void — 作废付款单（UNALLOCATED only，5C-2） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'supplier-payment:close');
  if (denied) return denied;
  requestLog(request, user?.id, 'supplier-payment.void');

  const { id } = await params;
  const meta = requestMeta(request);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.supplierPayment.findFirst({ where: { id, deletedAt: null } });
      if (!payment) throw new Error('NOT_FOUND');
      if (payment.voidedAt) return payment;
      if (payment.status !== 'UNALLOCATED') throw new Error('HAS_ALLOCATION');
      const updated = await tx.supplierPayment.update({
        where: { id },
        data: { voidedAt: new Date(), voidedById: user?.id ?? null, updatedAt: new Date() },
      });
      await writeAuditLog({
        actorId: user?.id,
        action: 'supplier-payment.void',
        entityType: 'supplierPayment',
        entityId: id,
        afterData: { voided: true },
        ...meta,
      });
      return updated;
    });
    return ok(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, '付款单不存在');
    if (msg === 'HAS_ALLOCATION') return failConflict(ERROR_CODES.CONFLICT, '已发生核销的付款单禁止作废（纠错请用核销 reversal）');
    console.error('[supplier-payment.void]', err);
    return failConflict(ERROR_CODES.INTERNAL_ERROR, '作废失败（事务已回滚）');
  }
}