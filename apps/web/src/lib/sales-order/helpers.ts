import { Prisma } from "@prisma/client";
import type { SalesOrderLine } from "@prisma/client";

/** Sprint 4B - Sales Order 领域辅助（编号生成 / 合计重算 / Revision 创建）
 * 对齐 Quotation helpers 模式；SalesOrder 不重新定价（ADR-0015：继承 Quotation 商业价格），
 * 仅当商业条件变更（数量/UOM）时才重新走 PricingEngine 并生成新 Revision + Snapshot。
 */

export const SALES_ORDER_DOC_TYPE = "SALES_ORDER";

/** DocumentSequence 原子取号（docType=SALES_ORDER，前缀 SO，位数 6） */
export async function nextSalesOrderCode(tx: Prisma.TransactionClient): Promise<string> {
  const seq = await tx.documentSequence.findFirst({
    where: { docType: "SALES_ORDER", isActive: true, deletedAt: null },
  });
  const prefix = seq?.prefix ?? "SO";
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

/** 重算销售订单头合计（subtotal/taxAmount/totalAmount，全程 Decimal） */
export async function recalcSalesOrderTotals(
  tx: Prisma.TransactionClient,
  salesOrderId: string,
  lines: Array<Pick<SalesOrderLine, "lineAmount" | "taxAmount" | "totalAmount">>,
) {
  const subtotal = lines.reduce((s, l) => s.plus(l.lineAmount), new Prisma.Decimal(0));
  const taxAmount = lines.reduce((s, l) => s.plus(l.taxAmount), new Prisma.Decimal(0));
  const totalAmount = lines.reduce((s, l) => s.plus(l.totalAmount), new Prisma.Decimal(0));
  return tx.salesOrder.update({ where: { id: salesOrderId }, data: { subtotal, taxAmount, totalAmount } });
}

/** 创建 Revision（系统生成，不开放自由编辑；revisionNo 自动递增） */
export async function createSalesOrderRevision(
  tx: Prisma.TransactionClient,
  salesOrderId: string,
  changeReason: string,
  snapshotData: unknown,
  actorId?: string | null,
) {
  const last = await tx.salesOrderRevision.findFirst({
    where: { salesOrderId, deletedAt: null },
    orderBy: { revisionNo: "desc" },
  });
  const revisionNo = (last?.revisionNo ?? 0) + 1;
  return tx.salesOrderRevision.create({
    data: {
      salesOrderId,
      revisionNo,
      revisionStatus: "DRAFT",
      changeReason,
      snapshotData: snapshotData === undefined ? Prisma.JsonNull : (snapshotData as Prisma.InputJsonValue),
      createdById: actorId ?? null,
      updatedById: actorId ?? null,
    },
  });
}
