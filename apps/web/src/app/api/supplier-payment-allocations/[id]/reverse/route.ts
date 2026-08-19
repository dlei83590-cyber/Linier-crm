import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, failConflict, failNotFound, failValidation } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const reverseSchema = z.object({
  reason: z.string().min(1).max(500),
});

/**
 * POST /api/supplier-payment-allocations/:id/reverse — 核销纠错（5C-2，Blocking ③ 纪律）
 * 追加 reversal（reversedAt/reversedBy/reverseReason 留痕），并同事务回滚 payment 投影与 ApOpenItem.openAmount 投影。
 * 不物理删除 allocation（不可变事实）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'supplier-payment-allocation:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'supplier-payment-allocation.reverse');

  const { id } = await params;
  const parsed = reverseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const meta = requestMeta(request);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const allocation = await tx.$queryRaw<Array<{ id: string; paymentId: string; apOpenItemId: string; allocatedAmount: string; reversedAt: Date | null }>>(
        Prisma.sql`SELECT "id", "paymentId", "apOpenItemId", "allocatedAmount", "reversedAt" FROM "SupplierPaymentAllocation" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      const row = allocation[0];
      if (!row) throw new Error('NOT_FOUND');
      if (row.reversedAt) throw new Error('ALREADY_REVERSED');

      // 锁 payment + openItem 头（锁序：allocation → payment → openItem，与 apply 一致的业务头后锁）
      const payments = await tx.$queryRaw<Array<{ id: string; allocatedAmount: string; unallocatedAmount: string; status: string }>>(
        Prisma.sql`SELECT "id", "allocatedAmount", "unallocatedAmount", "status" FROM "SupplierPayment" WHERE "id" = ${row.paymentId} FOR UPDATE`,
      );
      const items = await tx.$queryRaw<Array<{ id: string; openAmount: string }>>(
        Prisma.sql`SELECT "id", "openAmount" FROM "ApOpenItem" WHERE "id" = ${row.apOpenItemId} FOR UPDATE`,
      );
      const payment = payments[0];
      const openItem = items[0];
      if (!payment || !openItem) throw new Error('INCONSISTENT');

      const amt = new Prisma.Decimal(row.allocatedAmount);
      const nextAllocated = new Prisma.Decimal(payment.allocatedAmount).sub(amt);
      const nextUnallocated = new Prisma.Decimal(payment.unallocatedAmount).add(amt);
      const nextOpen = new Prisma.Decimal(openItem.openAmount).add(amt);
      const nextStatus = nextUnallocated.lte(0) ? 'ALLOCATED' : nextAllocated.lte(0) ? 'UNALLOCATED' : 'PARTIALLY_ALLOCATED';

      await tx.supplierPaymentAllocation.update({
        where: { id },
        data: { reversedAt: new Date(), reversedBy: user?.id ?? null, reverseReason: parsed.data.reason, updatedAt: new Date() },
      });
      await tx.supplierPayment.update({
        where: { id: row.paymentId },
        data: { allocatedAmount: nextAllocated, unallocatedAmount: nextUnallocated, status: nextStatus as never, updatedAt: new Date() },
      });
      await tx.apOpenItem.update({
        where: { id: row.apOpenItemId },
        data: { openAmount: nextOpen, updatedAt: new Date() },
      });

      await writeAuditLog({
        actorId: user?.id,
        action: 'supplier-payment-allocation.reverse',
        entityType: 'supplierPaymentAllocation',
        entityId: id,
        afterData: { reason: parsed.data.reason, openAmountAfter: nextOpen.toFixed(4) },
        ...meta,
      });
      return { id, reversed: true, openAmountAfter: nextOpen.toFixed(4) };
    });
    return ok(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, '核销记录不存在');
    if (msg === 'ALREADY_REVERSED') return failConflict(ERROR_CODES.CONFLICT, '该核销已反转（reversal 追加，禁止重复）');
    if (msg === 'INCONSISTENT') return failConflict(ERROR_CODES.INTERNAL_ERROR, '数据不一致（事务已回滚）');
    console.error('[supplier-payment-allocation.reverse]', err);
    return failConflict(ERROR_CODES.INTERNAL_ERROR, '反转失败（事务已回滚）');
  }
}