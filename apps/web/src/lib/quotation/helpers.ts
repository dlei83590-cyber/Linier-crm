import { Prisma, type PrismaClient } from "@prisma/client";
import type { QuotationLine } from "@prisma/client";

/** Sprint 4A - Quotation 领域辅助（编号生成 / 合计重算 / Revision 创建 / 惰性过期判定） */

export const QUOTATION_DOC_TYPE = "QUOTATION";

/** EXPIRED 惰性判定（CTO 决策②：不落库、不增调度器） */
export function effectiveStatusOf(q: { status: string; validUntil: Date | null }, now = new Date()) {
  const expirable = q.status === "SENT" || q.status === "APPROVED";
  const expired = expirable && q.validUntil !== null && q.validUntil < now;
  return expired
    ? { status: q.status, effectiveStatus: "EXPIRED", isExpired: true }
    : { status: q.status, effectiveStatus: q.status, isExpired: false };
}

/** DocumentSequence 原子取号（docType=QUOTATION，前缀 QT，位数 6） */
export async function nextQuotationCode(tx: Prisma.TransactionClient): Promise<string> {
  const seq = await tx.documentSequence.findFirst({
    where: { docType: "QUOTATION", isActive: true, deletedAt: null },
  });
  const prefix = seq?.prefix ?? "QT";
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

/** 重算报价头合计（subtotal/taxAmount/totalAmount，全程 Decimal） */
export async function recalcQuotationTotals(
  tx: Prisma.TransactionClient,
  quotationId: string,
  lines: Array<Pick<QuotationLine, "lineAmount" | "taxAmount" | "totalAmount">>,
) {
  const subtotal = lines.reduce((s, l) => s.plus(l.lineAmount), new Prisma.Decimal(0));
  const taxAmount = lines.reduce((s, l) => s.plus(l.taxAmount), new Prisma.Decimal(0));
  const totalAmount = lines.reduce((s, l) => s.plus(l.totalAmount), new Prisma.Decimal(0));
  return tx.quotation.update({ where: { id: quotationId }, data: { subtotal, taxAmount, totalAmount } });
}

/** 创建 Revision（系统生成，不开放自由编辑；revisionNo 自动递增） */
export async function createQuotationRevision(
  tx: Prisma.TransactionClient,
  quotationId: string,
  changeReason: string,
  snapshotData: unknown,
  actorId?: string | null,
) {
  const last = await tx.quotationRevision.findFirst({
    where: { quotationId, deletedAt: null },
    orderBy: { revisionNo: "desc" },
  });
  const revisionNo = (last?.revisionNo ?? 0) + 1;
  return tx.quotationRevision.create({
    data: {
      quotationId,
      revisionNo,
      revisionStatus: "DRAFT",
      changeReason,
      snapshotData: snapshotData === undefined ? Prisma.JsonNull : (snapshotData as Prisma.InputJsonValue),
      createdById: actorId ?? null,
      updatedById: actorId ?? null,
    },
  });
}
