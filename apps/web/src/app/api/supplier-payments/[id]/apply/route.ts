import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation } from '@/lib/api/response';
import { ERROR_CODES, type ErrorCode } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { z } from 'zod';
import { applySupplierPaymentAllocation } from '@/lib/supplier-payment/apply-helper';
import { publishSupplierPaymentEvent } from '@/lib/supplier-payment/events';

export const dynamic = 'force-dynamic';

const applySchema = z.object({
  apOpenItemId: z.string().min(1),
  allocatedAmount: z.number().positive(),
});

/**
 * POST /api/supplier-payments/:id/apply — 核销一个 AP Open Item（5C-2，ADR-0027 D7）
 * 同事务：核销行 + payment 投影 + ApOpenItem.openAmount 投影（防超核销锁内重算 + 同供应商同币种 + maker-checker）。
 * 事务提交后发布 SupplierPaymentApplied（AuditLog 留痕，EVENTS v1.34）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'supplier-payment:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'supplier-payment.apply');

  const { id } = await params;
  const parsed = applySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const meta = requestMeta(request);
  const actorId = user!.id;

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const r = await applySupplierPaymentAllocation(tx, {
        paymentId: id,
        apOpenItemId: parsed.data.apOpenItemId,
        allocatedAmount: new Prisma.Decimal(parsed.data.allocatedAmount),
        actorId,
      });
      if (!r.ok) return r;
      const p = await tx.supplierPayment.findFirst({
        where: { id },
        select: { code: true, supplierId: true },
      });
      await writeAuditLog({
        actorId: user?.id,
        action: 'supplier-payment.apply',
        entityType: 'supplierPaymentAllocation',
        entityId: parsed.data.apOpenItemId,
        afterData: { paymentId: id, apOpenItemId: parsed.data.apOpenItemId, allocatedAmount: parsed.data.allocatedAmount, openAmountAfter: r.openAmountAfter },
        ...meta,
      });
      return { ...r, code: p?.code ?? '', supplierId: p?.supplierId ?? '' };
    });

    if (!outcome.ok) {
      const codeMap: Record<string, { code: ErrorCode; msg: string; status: number }> = {
        NOT_FOUND: { code: ERROR_CODES.NOT_FOUND, msg: '付款单/未结项不存在', status: 404 },
        VOIDED: { code: ERROR_CODES.CONFLICT, msg: '付款单已作废，禁止核销', status: 409 },
        FULLY_ALLOCATED: { code: ERROR_CODES.CONFLICT, msg: '付款单已全额核销，禁止继续核销', status: 409 },
        MAKER_CHECKER: { code: ERROR_CODES.CONFLICT, msg: '核销人不能是付款单创建人（maker-checker）', status: 409 },
        OPEN_ITEM_NOT_FOUND: { code: ERROR_CODES.NOT_FOUND, msg: '目标 AP Open Item 不存在', status: 404 },
        SUPPLIER_MISMATCH: { code: ERROR_CODES.CONFLICT, msg: '核销目标供应商与付款单不一致', status: 409 },
        CURRENCY_MISMATCH: { code: ERROR_CODES.CONFLICT, msg: '核销目标币种与付款单不一致', status: 409 },
        INVALID_AMOUNT: { code: ERROR_CODES.VALIDATION_ERROR, msg: '核销金额必须大于 0', status: 400 },
        OVER_ALLOCATION: { code: ERROR_CODES.CONFLICT, msg: '核销金额超过应付未结项剩余（防超核销）', status: 409 },
        OVER_PAYMENT: { code: ERROR_CODES.CONFLICT, msg: '核销金额超过付款单未核销余额', status: 409 },
      };
      const mapped = codeMap[outcome.code] ?? { code: ERROR_CODES.INTERNAL_ERROR, msg: '核销失败（事务已回滚）', status: 500 };
      return fail(mapped.code, mapped.msg, mapped.status);
    }

    await publishSupplierPaymentEvent({
      eventType: 'SupplierPaymentApplied',
      actorId: user?.id,
      entityId: id,
      payload: {
        paymentId: id,
        code: outcome.code,
        supplierId: outcome.supplierId,
        apOpenItemId: parsed.data.apOpenItemId,
        allocatedAmount: parsed.data.allocatedAmount.toString(),
        openAmountAfter: outcome.openAmountAfter,
        unallocatedAmountAfter: outcome.unallocatedAmountAfter,
        allocatedById: actorId,
        allocatedAt: new Date().toISOString(),
      },
      meta: { requestId: meta.requestId ?? undefined },
    });

    return ok({ paymentId: id, apOpenItemId: parsed.data.apOpenItemId, status: 'ALLOCATED', openAmountAfter: outcome.openAmountAfter });
  } catch (err) {
    console.error('[supplier-payment.apply]', err);
    return fail(ERROR_CODES.INTERNAL_ERROR, '核销失败（事务已回滚）', 500);
  }
}