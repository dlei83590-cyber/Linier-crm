import { Prisma } from '@prisma/client';

/**
 * Sprint 5C-2 - Supplier Payment 领域通用函数（对齐 5C-1 helpers 模式）
 * code DocumentSequence 创建即取号（PAY-；docType=PAYMENT_VOUCHER 复用现有枚举，缺失 fail closed）
 */

export class SupplierPaymentSequenceMissingError extends Error {
  constructor() {
    super('PAYMENT_VOUCHER DocumentSequence 缺失（docType=PAYMENT_VOUCHER）——部署配置错误，请先执行 seed 初始化');
    this.name = 'SupplierPaymentSequenceMissingError';
  }
}

/** DocumentSequence 原子取号（docType=PAYMENT_VOUCHER；创建即取号 fail closed） */
export async function nextSupplierPaymentCode(tx: Prisma.TransactionClient): Promise<string> {
  const seq = await tx.documentSequence.findFirst({
    where: { docType: 'PAYMENT_VOUCHER' as never, isActive: true, deletedAt: null },
  });
  if (!seq) throw new SupplierPaymentSequenceMissingError();
  const updated = await tx.documentSequence.update({
    where: { id: seq.id },
    data: { nextNo: { increment: 1 } },
  });
  return `${seq.prefix}${String(updated.nextNo - 1).padStart(seq.padLength, '0')}`;
}