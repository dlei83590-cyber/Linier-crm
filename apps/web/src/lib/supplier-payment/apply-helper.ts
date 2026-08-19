import { Prisma } from '@prisma/client';

export type SupplierPaymentApplyResult =
  | { ok: true; openAmountAfter: string; unallocatedAmountAfter: string }
  | { ok: false; code: string; message: string; httpStatus: number };

interface LockedPaymentRow {
  id: string;
  supplierId: string;
  currency: string;
  amount: string;
  allocatedAmount: string;
  unallocatedAmount: string;
  status: string;
  version: number;
  voidedAt: Date | null;
  createdById: string | null;
}

interface LockedOpenItemRow {
  id: string;
  supplierId: string;
  currency: string;
  openAmount: string;
}

/**
 * 5C-2 Payment APPLY（ADR-0027 D7）：创建 SupplierPaymentAllocation + 更新 payment 投影 + ApOpenItem.openAmount 投影（同事务）。
 * 不变量：
 * - 锁序（与 CN/DN apply 一致）：先锁 Payment 头 FOR UPDATE → 再锁目标 ApOpenItem FOR UPDATE
 * - 同供应商同币种（硬规则）
 * - 防超核销：本次金额 ≤ openItem.openAmount 剩余 且 ≤ payment.unallocatedAmount（锁内重算）
 * - maker-checker：allocatedBy ≠ createdById
 * 调用方必须已处于 prisma.$transaction 内。
 */
export async function applySupplierPaymentAllocation(
  tx: Prisma.TransactionClient,
  params: { paymentId: string; apOpenItemId: string; allocatedAmount: Prisma.Decimal; actorId: string },
): Promise<SupplierPaymentApplyResult> {
  const payments = await tx.$queryRaw<LockedPaymentRow[]>(
    Prisma.sql`SELECT "id", "supplierId", "currency", "amount", "allocatedAmount", "unallocatedAmount", "status", "version", "voidedAt", "createdById" FROM "SupplierPayment" WHERE "id" = ${params.paymentId} AND "deletedAt" IS NULL FOR UPDATE`,
  );
  const payment = payments[0];
  if (!payment) return { ok: false, code: 'NOT_FOUND', message: '付款单不存在', httpStatus: 404 };
  if (payment.voidedAt) return { ok: false, code: 'VOIDED', message: '付款单已作废，禁止核销', httpStatus: 409 };
  if (payment.status === 'ALLOCATED' && new Prisma.Decimal(payment.unallocatedAmount).lte(0)) {
    return { ok: false, code: 'FULLY_ALLOCATED', message: '付款单已全额核销，禁止继续核销', httpStatus: 409 };
  }
  if (payment.createdById === params.actorId) {
    return { ok: false, code: 'MAKER_CHECKER', message: '核销人不能是付款单创建人（maker-checker）', httpStatus: 409 };
  }

  const items = await tx.$queryRaw<LockedOpenItemRow[]>(
    Prisma.sql`SELECT "id", "supplierId", "currency", "openAmount" FROM "ApOpenItem" WHERE "id" = ${params.apOpenItemId} FOR UPDATE`,
  );
  const openItem = items[0];
  if (!openItem) return { ok: false, code: 'OPEN_ITEM_NOT_FOUND', message: '目标 AP Open Item 不存在', httpStatus: 404 };
  if (openItem.supplierId !== payment.supplierId) {
    return { ok: false, code: 'SUPPLIER_MISMATCH', message: '核销目标供应商与付款单不一致（同供应商硬规则）', httpStatus: 409 };
  }
  if (openItem.currency !== payment.currency) {
    return { ok: false, code: 'CURRENCY_MISMATCH', message: '核销目标币种与付款单不一致（同币种硬规则）', httpStatus: 409 };
  }

  const currentOpen = new Prisma.Decimal(openItem.openAmount);
  const unallocated = new Prisma.Decimal(payment.unallocatedAmount);
  if (params.allocatedAmount.lte(0)) return { ok: false, code: 'INVALID_AMOUNT', message: '核销金额必须大于 0', httpStatus: 400 };
  if (params.allocatedAmount.gt(currentOpen)) {
    return { ok: false, code: 'OVER_ALLOCATION', message: '核销金额超过应付未结项剩余（防超核销，锁内重算）', httpStatus: 409 };
  }
  if (params.allocatedAmount.gt(unallocated)) {
    return { ok: false, code: 'OVER_PAYMENT', message: '核销金额超过付款单未核销余额', httpStatus: 409 };
  }

  const nextOpen = currentOpen.sub(params.allocatedAmount);
  const nextAllocated = new Prisma.Decimal(payment.allocatedAmount).add(params.allocatedAmount);
  const nextUnallocated = unallocated.sub(params.allocatedAmount);
  const nextStatus = nextUnallocated.lte(0) ? 'ALLOCATED' : 'PARTIALLY_ALLOCATED';

  // 同事务：核销行 + payment 投影 + openItem 投影（failure atomicity）
  await tx.supplierPaymentAllocation.create({
    data: {
      paymentId: payment.id,
      apOpenItemId: openItem.id,
      allocatedAmount: params.allocatedAmount,
      allocatedBy: params.actorId,
      createdById: params.actorId,
    },
  });
  await tx.supplierPayment.update({
    where: { id: payment.id },
    data: {
      allocatedAmount: nextAllocated,
      unallocatedAmount: nextUnallocated,
      status: nextStatus as never,
      updatedAt: new Date(),
    },
  });
  await tx.apOpenItem.update({
    where: { id: openItem.id },
    data: { openAmount: nextOpen, updatedAt: new Date() },
  });

  return { ok: true, openAmountAfter: nextOpen.toFixed(4), unallocatedAmountAfter: nextUnallocated.toFixed(4) };
}