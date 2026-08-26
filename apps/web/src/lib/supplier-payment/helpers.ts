import { Prisma } from '@prisma/client';
import { nextDocumentCode, DocumentSequenceMissingError } from '@/lib/document-sequence/next-code';

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

/** DocumentSequence 原子取号（docType=PAYMENT_VOUCHER；创建即取号 fail closed；单据序列重构：PV-LNE{YYYY}{MM}{####}） */
export async function nextSupplierPaymentCode(tx: Prisma.TransactionClient, documentDate: Date): Promise<string> {
  try {
    return await nextDocumentCode(tx, 'PAYMENT_VOUCHER', documentDate);
  } catch (err) {
    if (err instanceof DocumentSequenceMissingError) throw new SupplierPaymentSequenceMissingError();
    throw err;
  }
}