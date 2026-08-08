import { Prisma } from "@prisma/client";

/** Sprint 4E-2 - Receipt 领域辅助（编号生成 / Revision / Snapshot 创建）
 * 对齐 Invoice/SalesOrder helpers 模式；CTO Design Review 97/100 锁定：
 * - Receipt.code DocumentSequence **创建即取号**（拍板④：RCT-2026-xxxx；Receipt 是实际收款凭证，创建即财务事实，与 Invoice DRAFT 不占号不同）
 * - 创建与核销分离（拍板①）：POST /api/receipts 只记录实际收到的钱（UNALLOCATED），不核销
 * - unallocatedAmount 受控投影（拍板⑤）：= amount - Σ allocatedAmount；只能由 allocate/reversal 事务更新，禁止 PATCH
 * - Decimal 全程：Snapshot/Revision JSON 金额一律 toString()，禁止 toNumber()
 */

export const RECEIPT_DOC_TYPE = "RECEIPT";

/** DocumentSequence 原子取号（docType=RECEIPT，前缀 RCT，位数 6；创建即取号——拍板④） */
export async function nextReceiptCode(tx: Prisma.TransactionClient): Promise<string> {
  const seq = await tx.documentSequence.findFirst({
    where: { docType: "RECEIPT", isActive: true, deletedAt: null },
  });
  const prefix = seq?.prefix ?? "RCT";
  const padLength = seq?.padLength ?? 6;
  if (seq) {
    const updated = await tx.documentSequence.update({
      where: { id: seq.id },
      data: { nextNo: { increment: 1 } },
    });
    return `${prefix}${String(updated.nextNo - 1).padStart(padLength, "0")}`;
  }
  return `${prefix}${String(1).padStart(padLength, "0")}`;
}

/** 创建 ReceiptRevision（系统生成，不开放自由编辑；revisionNo 自动递增） */
export async function createReceiptRevision(
  tx: Prisma.TransactionClient,
  receiptId: string,
  changeReason: string,
  snapshotData: unknown,
  actorId?: string | null,
) {
  const last = await tx.receiptRevision.findFirst({
    where: { receiptId, deletedAt: null },
    orderBy: { revisionNo: "desc" },
  });
  const revisionNo = (last?.revisionNo ?? 0) + 1;
  return tx.receiptRevision.create({
    data: {
      receiptId,
      revisionNo,
      changeReason,
      snapshotData: snapshotData === undefined ? Prisma.JsonNull : (snapshotData as Prisma.InputJsonValue),
      createdById: actorId ?? null,
      updatedById: actorId ?? null,
    },
  });
}

/** 创建 ReceiptSnapshot（固化节点：CREATED/ALLOCATED/VOIDED/REVERSED；Decimal 一律 toString） */
export async function createReceiptSnapshot(
  tx: Prisma.TransactionClient,
  receiptId: string,
  snapshotType: "CREATED" | "ALLOCATED" | "VOIDED" | "REVERSED",
  revisionNo: number,
  snapshotData: unknown,
  actorId?: string | null,
) {
  return tx.receiptSnapshot.create({
    data: {
      receiptId,
      snapshotType,
      revisionNo,
      snapshotData: snapshotData === undefined ? Prisma.JsonNull : (snapshotData as Prisma.InputJsonValue),
      generatedById: actorId ?? null,
      createdById: actorId ?? null,
      updatedById: actorId ?? null,
    },
  });
}

/** 取 Receipt 当前最新修订号（快照对应；无修订时回退 1） */
export async function latestReceiptRevisionNo(
  tx: Prisma.TransactionClient,
  receiptId: string,
): Promise<number> {
  const last = await tx.receiptRevision.findFirst({
    where: { receiptId, deletedAt: null },
    orderBy: { revisionNo: "desc" },
    select: { revisionNo: true },
  });
  return last?.revisionNo ?? 1;
}
