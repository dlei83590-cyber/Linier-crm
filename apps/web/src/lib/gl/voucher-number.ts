import { Prisma } from '@prisma/client';
import type { GlVoucherType } from '@prisma/client';

/**
 * 凭证号共享取号引擎（ADR-0044，INV3）
 * 按 (期间, 凭证字) 连续编号：DocumentSequence.code = 'JRN:' + periodKey + ':' + voucherType（如 JRN:202608:GENERAL）
 * voucherNo = 凭证字 + periodKey + '-' + pad(nextNo)（如 记202608-0001）；FOR UPDATE 原子取号。
 * 替换 posting.ts / period-close.ts / [action].route.ts 三处重复实现。
 */

const VOUCHER_TYPE_CHAR: Record<GlVoucherType, string> = {
  GENERAL: '记',
  RECEIPT: '收',
  PAYMENT: '付',
  TRANSFER: '转',
};

export function voucherTypeChar(type: GlVoucherType): string {
  return VOUCHER_TYPE_CHAR[type] ?? '记';
}

/** 取号（事务内，FOR UPDATE 原子；行不存在则创建 nextNo=1——首张凭证） */
export async function nextVoucherNo(
  tx: Prisma.TransactionClient,
  params: { periodKey: string; voucherType: GlVoucherType },
): Promise<string> {
  const code = 'JRN:' + params.periodKey + ':' + params.voucherType;
  let seq = await tx.documentSequence.findFirst({ where: { code, deletedAt: null } });
  if (!seq) {
    try {
      seq = await tx.documentSequence.create({
        data: {
          code,
          name: '日记账（' + params.periodKey + ' ' + voucherTypeChar(params.voucherType) + '）',
          docType: 'JOURNAL' as never,
          prefix: null,
          nextNo: 1,
          padLength: 4,
          periodPattern: '{YYYY}{MM}',
          perPeriodReset: true,
          approvalStatus: 'APPROVED' as never,
        },
      });
    } catch (err) {
      // 并发创建冲突（P2002）：重查已存在行
      const existing = await tx.documentSequence.findFirst({ where: { code, deletedAt: null } });
      if (!existing) throw err;
      seq = existing;
    }
  }
  // FOR UPDATE 锁行（并发取号串行化）
  await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "DocumentSequence" WHERE "id" = ${seq.id} FOR UPDATE`);
  const updated = await tx.documentSequence.update({
    where: { id: seq.id },
    data: { nextNo: { increment: 1 } },
  });
  const pad = String(updated.nextNo - 1).padStart(seq.padLength, '0');
  return voucherTypeChar(params.voucherType) + params.periodKey + '-' + pad;
}
