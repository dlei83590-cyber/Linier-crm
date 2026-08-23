import { Prisma } from '@prisma/client';

/**
 * 单号回收（用户指令 2026-08-21 全程回收单号）：删除单据时若其单号是当前序列最后一张（序号 == nextNo-1），
 * DocumentSequence.nextNo 回退一位，下次新建复用该单号；CAS（updateMany where {id, nextNo}）防并发取号已推进时误回退他人单号。
 * 对齐报价单先例（quotations DELETE 单号回收）。
 */
export async function recycleDocumentSequence(
  tx: Prisma.TransactionClient,
  docType: string,
  code: string | null | undefined,
): Promise<void> {
  if (!code) return;
  const m = code.match(/(\d+)$/);
  if (!m) return;
  const seqNo = Number(m[1]);
  if (!Number.isFinite(seqNo)) return;
  const seq = await tx.documentSequence.findFirst({
    where: { docType: docType as never, isActive: true, deletedAt: null },
    select: { id: true, nextNo: true },
  });
  if (!seq) return;
  if (seqNo === seq.nextNo - 1) {
    await tx.documentSequence.updateMany({
      where: { id: seq.id, nextNo: seq.nextNo },
      data: { nextNo: seq.nextNo - 1 },
    });
  }
}