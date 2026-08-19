import { Prisma } from '@prisma/client';

/**
 * Sprint 5C-2 - Supplier CN/DN 领域通用函数（对齐 5C-1 helpers 模式；不放路由逻辑）
 * - code DocumentSequence 创建即取号（SCN/SDN；docType=SUPPLIER_CREDIT_NOTE/SUPPLIER_DEBIT_NOTE，缺失 fail closed）
 * - 金额全部服务端 Decimal 计算（不信任客户端头/行金额）
 */

export class SupplierCnDnSequenceMissingError extends Error {
  constructor(docType: string) {
    super(docType + ' DocumentSequence 缺失（docType=' + docType + '）——部署配置错误，请先执行 seed 初始化');
    this.name = 'SupplierCnDnSequenceMissingError';
  }
}

/** DocumentSequence 原子取号（按 noteType 选 docType；创建即取号 fail closed） */
export async function nextSupplierCnDnCode(
  tx: Prisma.TransactionClient,
  noteType: 'CREDIT' | 'DEBIT',
): Promise<string> {
  const docType = noteType === 'CREDIT' ? 'SUPPLIER_CREDIT_NOTE' : 'SUPPLIER_DEBIT_NOTE';
  const seq = await tx.documentSequence.findFirst({
    where: { docType: docType as never, isActive: true, deletedAt: null },
  });
  if (!seq) throw new SupplierCnDnSequenceMissingError(docType);
  const updated = await tx.documentSequence.update({
    where: { id: seq.id },
    data: { nextNo: { increment: 1 } },
  });
  return `${seq.prefix}${String(updated.nextNo - 1).padStart(seq.padLength, '0')}`;
}

/** 行金额服务端计算：amount = quantity × unitPrice（快照单价，4dp；全程 Decimal） */
export function computeCnDnLineAmount(params: { quantity: Prisma.Decimal; unitPrice: Prisma.Decimal }): Prisma.Decimal {
  return params.quantity.mul(params.unitPrice).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

/** 头金额聚合：adjustmentTotal = Σ lines amount（服务端，禁止直传头金额） */
export function aggregateCnDnTotal(lines: Array<{ amount: Prisma.Decimal }>): Prisma.Decimal {
  return lines.reduce((acc, l) => acc.add(l.amount), new Prisma.Decimal(0));
}