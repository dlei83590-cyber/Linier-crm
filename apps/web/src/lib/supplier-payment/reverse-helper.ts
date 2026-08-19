import { Prisma } from '@prisma/client';

export type SupplierPaymentReverseResult =
  | { ok: true; reversedAllocations: number }
  | { ok: false; code: string; message: string; httpStatus: number };

interface LockedPaymentRow {
  id: string;
  amount: string;
  version: number;
  reversedAt: Date | null;
  voidedAt: Date | null;
  createdById: string | null;
}

interface LockedOpenItemRow {
  id: string;
  openAmount: string;
}

/**
 * 5C-2 Payment 整体冲销（Red Reversal，ADR-0030 backlog）：
 * 反转付款单全部未反转 allocations + 回滚各 ApOpenItem.openAmount 投影 + 回滚 payment 投影 + 标记 reversed（同事务）。
 * 不变量：
 * - 锁序（与 apply 一致）：Payment 头 FOR UPDATE → 涉及 openItems（按 id 排序）FOR UPDATE
 * - maker-checker（reverse 人 ≠ 创建人）；幂等（已 reversed → 409）
 * - 已作废单（UNALLOCATED void）无需冲销（走 void）；无未反转核销 → 409（用 void 更合适）
 * 调用方必须已处于 prisma.$transaction 内。
 */
export async function reverseSupplierPayment(
  tx: Prisma.TransactionClient,
  params: { paymentId: string; reason: string; version: number; actorId: string },
): Promise<SupplierPaymentReverseResult> {
  const payments = await tx.$queryRaw<LockedPaymentRow[]>(
    Prisma.sql`SELECT "id", "amount", "version", "reversedAt", "voidedAt", "createdById" FROM "SupplierPayment" WHERE "id" = ${params.paymentId} AND "deletedAt" IS NULL FOR UPDATE`,
  );
  const payment = payments[0];
  if (!payment) return { ok: false, code: 'NOT_FOUND', message: '付款单不存在', httpStatus: 404 };
  if (payment.reversedAt) return { ok: false, code: 'ALREADY_REVERSED', message: '付款单已整体冲销，幂等拒绝', httpStatus: 409 };
  if (payment.voidedAt) return { ok: false, code: 'VOIDED', message: '付款单已作废（未核销场景走 void；已核销不可 void）', httpStatus: 409 };
  if (payment.version !== params.version) return { ok: false, code: 'VERSION_CONFLICT', message: '版本冲突，请刷新后重试', httpStatus: 409 };
  if (payment.createdById === params.actorId) return { ok: false, code: 'MAKER_CHECKER', message: '冲销人不能是付款单创建人（maker-checker）', httpStatus: 409 };

  const allocations = await tx.supplierPaymentAllocation.findMany({
    where: { paymentId: payment.id, reversedAt: null, deletedAt: null },
    orderBy: { allocatedAt: 'asc' },
    select: { id: true, apOpenItemId: true, allocatedAmount: true },
  });
  if (allocations.length === 0) {
    return { ok: false, code: 'NO_ALLOCATIONS', message: '该付款单无未反转核销记录（未核销场景请用作废 void）', httpStatus: 409 };
  }

  // 锁涉及 openItems（按 id 排序，锁序一致防死锁）
  const openItemIds = [...new Set(allocations.map((a) => a.apOpenItemId))].sort();
  const items = await tx.$queryRaw<LockedOpenItemRow[]>(
    Prisma.sql`SELECT "id", "openAmount" FROM "ApOpenItem" WHERE "id" IN (${Prisma.join(openItemIds)}) FOR UPDATE`,
  );
  const itemById = new Map(items.map((i) => [i.id, i]));

  // 按 openItem 分组回滚金额
  const rollbackByItem = new Map<string, Prisma.Decimal>();
  for (const a of allocations) {
    const cur = rollbackByItem.get(a.apOpenItemId) ?? new Prisma.Decimal(0);
    rollbackByItem.set(a.apOpenItemId, cur.add(new Prisma.Decimal(a.allocatedAmount.toString())));
  }
  for (const [openItemId, amount] of rollbackByItem) {
    const oi = itemById.get(openItemId);
    if (!oi) return { ok: false, code: 'INCONSISTENT', message: '核销目标未结项不存在（数据异常，事务已回滚）', httpStatus: 500 };
    await tx.apOpenItem.update({
      where: { id: openItemId },
      data: { openAmount: new Prisma.Decimal(oi.openAmount).add(amount), updatedAt: new Date() },
    });
  }

  // 反转全部 allocations
  const now = new Date();
  for (const a of allocations) {
    await tx.supplierPaymentAllocation.update({
      where: { id: a.id },
      data: { reversedAt: now, reversedBy: params.actorId, reverseReason: params.reason, updatedAt: now },
    });
  }

  // 回滚 payment 投影 + 标记 reversed
  await tx.supplierPayment.update({
    where: { id: payment.id },
    data: {
      allocatedAmount: new Prisma.Decimal(0),
      unallocatedAmount: new Prisma.Decimal(payment.amount),
      status: 'UNALLOCATED',
      reversedAt: now,
      reversedById: params.actorId,
      reverseReason: params.reason,
      version: { increment: 1 },
      updatedAt: now,
    },
  });

  return { ok: true, reversedAllocations: allocations.length };
}