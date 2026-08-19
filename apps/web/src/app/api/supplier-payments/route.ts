import { NextRequest } from 'next/server';
import type { SupplierPaymentStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, failValidation, failConflict, parsePagination } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { z } from 'zod';
import { nextSupplierPaymentCode, SupplierPaymentSequenceMissingError } from '@/lib/supplier-payment/helpers';

export const dynamic = 'force-dynamic';

const paymentCreateSchema = z.object({
  supplierId: z.string().min(1),
  currency: z.string().max(10).optional(),
  amount: z.number().positive(),
  paymentDate: z.string().datetime(),
  paymentMethod: z.enum(['BANK_TRANSFER', 'CHEQUE', 'CASH', 'CARD', 'OTHER']),
  referenceNo: z.string().max(100).nullable().optional(),
});

/** GET /api/supplier-payments（分页 + supplierId/status/currency/paymentDate 范围过滤，5C-2） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'supplier-payment:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'supplier-payment.list');

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const supplierId = searchParams.get('supplierId')?.trim();
  const status = searchParams.get('status')?.trim();
  const currency = searchParams.get('currency')?.trim();
  const dateFrom = searchParams.get('dateFrom')?.trim();
  const dateTo = searchParams.get('dateTo')?.trim();

  const where = {
    deletedAt: null,
    ...(supplierId ? { supplierId } : {}),
    ...(status ? { status: status as SupplierPaymentStatus } : {}),
    ...(currency ? { currency } : {}),
    ...(dateFrom ? { paymentDate: { gte: new Date(dateFrom) } } : {}),
    ...(dateTo ? { paymentDate: { lte: new Date(dateTo) } } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.supplierPayment.count({ where }),
    prisma.supplierPayment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        supplier: { select: { id: true, code: true, name: true } },
        _count: { select: { allocations: true } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/supplier-payments（创建付款单：code 创建即取号 PAYMENT_VOUCHER；金额为付款事实） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'supplier-payment:create');
  if (denied) return denied;
  requestLog(request, user?.id, 'supplier-payment.create');

  const meta = requestMeta(request);
  const parsed = paymentCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  try {
    const created = await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({ where: { id: parsed.data.supplierId, deletedAt: null }, select: { id: true } });
      if (!supplier) throw new Error('SUPPLIER_NOT_FOUND');
      const code = await nextSupplierPaymentCode(tx);
      const payment = await tx.supplierPayment.create({
        data: {
          code,
          supplierId: parsed.data.supplierId,
          currency: parsed.data.currency ?? 'CNY',
          amount: new Prisma.Decimal(parsed.data.amount),
          allocatedAmount: new Prisma.Decimal(0),
          unallocatedAmount: new Prisma.Decimal(parsed.data.amount),
          paymentDate: new Date(parsed.data.paymentDate),
          paymentMethod: parsed.data.paymentMethod as never,
          referenceNo: parsed.data.referenceNo ?? null,
          createdById: user?.id ?? null,
          updatedById: user?.id ?? null,
        },
      });
      await writeAuditLog({
        actorId: user?.id,
        action: 'supplier-payment.create',
        entityType: 'supplierPayment',
        entityId: payment.id,
        afterData: { code: payment.code, amount: payment.amount.toString() },
        ...meta,
      });
      return payment;
    });
    return ok(created, undefined, 201);
  } catch (err) {
    if (err instanceof SupplierPaymentSequenceMissingError) return failConflict(ERROR_CODES.INTERNAL_ERROR, err.message);
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'SUPPLIER_NOT_FOUND') return failConflict(ERROR_CODES.NOT_FOUND, '供应商不存在');
    console.error('[supplier-payment.create]', err);
    return failConflict(ERROR_CODES.INTERNAL_ERROR, '创建付款单失败（事务已回滚）');
  }
}