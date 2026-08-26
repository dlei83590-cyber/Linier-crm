import { Prisma } from '@prisma/client';
import { parsePeriodCode } from './next-code';

/**
 * 单号回收（用户指令 2026-08-21 全程回收单号）：删除单据时若其单号是该期间序列最后一张
 * （序号 == 期间行 nextNo-1），期间行 DocumentSequence.nextNo 回退一位，下次新建复用该单号；
 * CAS（updateMany where {id, nextNo}）防并发取号已推进时误回退他人单号。
 * 期间行 code = `${docType}:${periodKey}`（单据序列重构后按月重排）；历史旧格式单号（无 LNE 段）不参与回收。
 */
export async function recycleDocumentSequence(
  tx: Prisma.TransactionClient,
  docType: string,
  code: string | null | undefined,
): Promise<void> {
  const parsed = parsePeriodCode(code);
  if (!parsed) return;
  const seq = await tx.documentSequence.findFirst({
    where: { code: docType + ':' + parsed.periodKey, isActive: true, deletedAt: null },
    select: { id: true, nextNo: true },
  });
  if (!seq) return;
  if (parsed.seqNo === seq.nextNo - 1) {
    await tx.documentSequence.updateMany({
      where: { id: seq.id, nextNo: seq.nextNo },
      data: { nextNo: seq.nextNo - 1 },
    });
  }
}
