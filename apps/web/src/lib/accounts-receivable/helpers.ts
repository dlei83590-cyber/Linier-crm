import { Prisma } from "@prisma/client";

/** Sprint 4E-2 - AccountsReceivable 领域辅助（Revision / Snapshot 创建）
 * 对齐 Invoice/Receipt helpers 模式；CTO Design Review 97/100 锁定：
 * - AR 余额唯一口径 balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount（computeBalance 单入口）
 * - Snapshot snapshotSource 复用 4E-1 枚举：PAYMENT（4E-2 核销）/ WRITE_OFF（WriteOff Apply）/ ADJUSTMENT（4E-3 CN/DN）/ MANUAL
 * - 金额 Decimal 一律 toString()，禁止 toNumber()
 */

/** 创建 AccountsReceivableRevision（余额变更留痕；系统生成，禁止手工编辑；revisionNo 自动递增） */
export async function createAccountsReceivableRevision(
  tx: Prisma.TransactionClient,
  accountsReceivableId: string,
  changeReason: string,
  snapshotData: unknown,
  actorId?: string | null,
) {
  const last = await tx.accountsReceivableRevision.findFirst({
    where: { accountsReceivableId, deletedAt: null },
    orderBy: { revisionNo: "desc" },
  });
  const revisionNo = (last?.revisionNo ?? 0) + 1;
  return tx.accountsReceivableRevision.create({
    data: {
      accountsReceivableId,
      revisionNo,
      changeReason,
      snapshotData: snapshotData === undefined ? Prisma.JsonNull : (snapshotData as Prisma.InputJsonValue),
      createdById: actorId ?? null,
      updatedById: actorId ?? null,
    },
  });
}

/** 创建 AccountsReceivableSnapshot（关键节点固化；snapshotSource 来源枚举——CTO 必改② 复用） */
export async function createAccountsReceivableSnapshot(
  tx: Prisma.TransactionClient,
  accountsReceivableId: string,
  snapshotType: "CREATED" | "PARTIALLY_PAID" | "PAID" | "ADJUSTED" | "WRITTEN_OFF" | "CLOSED",
  snapshotSource: "ISSUE" | "PAYMENT" | "WRITE_OFF" | "ADJUSTMENT" | "MANUAL",
  revisionNo: number,
  snapshotData: unknown,
  actorId?: string | null,
) {
  return tx.accountsReceivableSnapshot.create({
    data: {
      accountsReceivableId,
      snapshotType,
      snapshotSource,
      revisionNo,
      snapshotData: snapshotData === undefined ? Prisma.JsonNull : (snapshotData as Prisma.InputJsonValue),
      generatedById: actorId ?? null,
      createdById: actorId ?? null,
      updatedById: actorId ?? null,
    },
  });
}

/** 取 AR 当前最新修订号（快照对应；无修订时回退 1） */
export async function latestAccountsReceivableRevisionNo(
  tx: Prisma.TransactionClient,
  accountsReceivableId: string,
): Promise<number> {
  const last = await tx.accountsReceivableRevision.findFirst({
    where: { accountsReceivableId, deletedAt: null },
    orderBy: { revisionNo: "desc" },
    select: { revisionNo: true },
  });
  return last?.revisionNo ?? 1;
}
