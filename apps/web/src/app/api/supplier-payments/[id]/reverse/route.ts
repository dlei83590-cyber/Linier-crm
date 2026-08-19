import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation } from '@/lib/api/response';
import { ERROR_CODES, type ErrorCode } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { z } from 'zod';
import { reverseSupplierPayment } from '@/lib/supplier-payment/reverse-helper';
import { writeSupplierPaymentReversedEvent } from '@/lib/supplier-payment/events';

export const dynamic = 'force-dynamic';

const reverseSchema = z.object({
  reason: z.string().min(1).max(500),
  version: z.number().int().positive(),
});

/**
 * POST /api/supplier-payments/:id/reverse — 付款单整体冲销（Red Reversal，5C-2，ADR-0030 backlog）
 * 同事务：反转全部未反转 allocations + 回滚各 ApOpenItem.openAmount 投影 + 回滚 payment 投影 + 标记 reversed
 * （maker-checker / 幂等 / 锁序与 apply 一致）；事件 SupplierPaymentReversed 事务内原子写 Outbox。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'supplier-payment:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'supplier-payment.reverse');

  const { id } = await params;
  const parsed = reverseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const meta = requestMeta(request);
  const actorId = user!.id;

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const r = await reverseSupplierPayment(tx, {
        paymentId: id,
        reason: parsed.data.reason,
        version: parsed.data.version,
        actorId,
      });
      if (!r.ok) return r;
      const p = await tx.supplierPayment.findFirst({
        where: { id },
        select: { code: true, supplierId: true },
      });
      await writeSupplierPaymentReversedEvent(tx, {
        paymentId: id,
        payload: {
          paymentId: id,
          code: p?.code ?? '',
          supplierId: p?.supplierId ?? '',
          reversedAllocations: r.reversedAllocations,
          allocatedById: actorId,
          allocatedAt: new Date().toISOString(),
        },
      });
      await writeAuditLog({
        actorId: user?.id,
        action: 'supplier-payment.reverse',
        entityType: 'supplierPayment',
        entityId: id,
        afterData: { reason: parsed.data.reason, reversedAllocations: r.reversedAllocations },
        ...meta,
      });
      return r;
    });

    if (!outcome.ok) {
      const codeMap: Record<string, { code: ErrorCode; msg: string; status: number }> = {
        NOT_FOUND: { code: ERROR_CODES.NOT_FOUND, msg: '付款单不存在', status: 404 },
        ALREADY_REVERSED: { code: ERROR_CODES.CONFLICT, msg: '付款单已整体冲销，幂等拒绝', status: 409 },
        VOIDED: { code: ERROR_CODES.CONFLICT, msg: '付款单已作废（未核销场景走 void）', status: 409 },
        VERSION_CONFLICT: { code: ERROR_CODES.VERSION_CONFLICT, msg: '版本冲突，请刷新后重试', status: 409 },
        MAKER_CHECKER: { code: ERROR_CODES.CONFLICT, msg: '冲销人不能是付款单创建人（maker-checker）', status: 409 },
        NO_ALLOCATIONS: { code: ERROR_CODES.CONFLICT, msg: '该付款单无未反转核销记录（未核销场景请用作废 void）', status: 409 },
        INCONSISTENT: { code: ERROR_CODES.INTERNAL_ERROR, msg: '数据不一致（事务已回滚）', status: 500 },
      };
      const mapped = codeMap[outcome.code] ?? { code: ERROR_CODES.INTERNAL_ERROR, msg: '整体冲销失败（事务已回滚）', status: 500 };
      return fail(mapped.code, mapped.msg, mapped.status);
    }

    return ok({ id, reversed: true, reversedAllocations: outcome.reversedAllocations });
  } catch (err) {
    console.error('[supplier-payment.reverse]', err);
    return fail(ERROR_CODES.INTERNAL_ERROR, '整体冲销失败（事务已回滚）', 500);
  }
}