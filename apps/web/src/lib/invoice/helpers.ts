import { Prisma } from "@prisma/client";

/** Sprint 4D - Invoice 领域辅助（编号生成 / Revision / Snapshot 创建）
 * 对齐 Delivery/SalesOrder helpers 模式；CTO Review 96/100 锁定：
 * - Invoice.code 可空：DRAFT 不占号，仅 ISSUE 时从 DocumentSequence 取号（必改①）
 * - InvoiceSnapshot 必须含完整税务/汇率快照（必改②：taxProfileId/taxRate/sstNo/currencyRate/exchangeRate）
 * - 金额红线：Invoice 永不重算价格——经四段溯源链（DeliveryLine → SalesOrderLine → QuotationPriceSnapshot）
 *   复制价格参数（unitPrice/discountRate/taxRate），行金额按开票数量算术计算，不调用 Pricing Engine
 */

export const INVOICE_DOC_TYPE = "INVOICE";

/** DocumentSequence 原子取号（docType=INVOICE，前缀 INV，位数 6；仅 ISSUE 时调用，DRAFT 不占号） */
export async function nextInvoiceCode(tx: Prisma.TransactionClient): Promise<string> {
  const seq = await tx.documentSequence.findFirst({
    where: { docType: "INVOICE", isActive: true, deletedAt: null },
  });
  const prefix = seq?.prefix ?? "INV";
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

/** 创建 InvoiceRevision（系统生成，不开放自由编辑；revisionNo 自动递增） */
export async function createInvoiceRevision(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  changeReason: string,
  snapshotData: unknown,
  actorId?: string | null,
) {
  const last = await tx.invoiceRevision.findFirst({
    where: { invoiceId, deletedAt: null },
    orderBy: { revisionNo: "desc" },
  });
  const revisionNo = (last?.revisionNo ?? 0) + 1;
  return tx.invoiceRevision.create({
    data: {
      invoiceId,
      revisionNo,
      revisionStatus: "DRAFT",
      changeReason,
      snapshotData: snapshotData === undefined ? Prisma.JsonNull : (snapshotData as Prisma.InputJsonValue),
      createdById: actorId ?? null,
      updatedById: actorId ?? null,
    },
  });
}

/** 创建 InvoiceSnapshot（固化节点生成；revisionNo 取当前最新修订号；Decimal 一律 toString 落 JSON，禁止 toNumber）
 * 税务/汇率快照（CTO 必改②）：taxProfileId/taxRate/sstNo/currencyRate/exchangeRate——几年后汇率/税率/SST 变化仍可 100% 还原。
 */
export async function createInvoiceSnapshot(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  snapshotType: "CREATED" | "ISSUED" | "CANCELLED",
  revisionNo: number,
  snapshotData: unknown,
  actorId?: string | null,
  taxSnapshot?: {
    taxProfileId?: string | null;
    taxRate?: Prisma.Decimal | null;
    sstNo?: string | null;
    currencyRate?: Prisma.Decimal | null;
    exchangeRate?: Prisma.Decimal | null;
  } | null,
) {
  return tx.invoiceSnapshot.create({
    data: {
      invoiceId,
      snapshotType,
      revisionNo,
      snapshotData: snapshotData === undefined ? Prisma.JsonNull : (snapshotData as Prisma.InputJsonValue),
      taxProfileId: taxSnapshot?.taxProfileId ?? null,
      taxRate: taxSnapshot?.taxRate ?? null,
      sstNo: taxSnapshot?.sstNo ?? null,
      currencyRate: taxSnapshot?.currencyRate ?? null,
      exchangeRate: taxSnapshot?.exchangeRate ?? null,
      generatedById: actorId ?? null,
      createdById: actorId ?? null,
      updatedById: actorId ?? null,
    },
  });
}

/** 取 Invoice 当前最新修订号（快照对应；无修订时回退 1） */
export async function latestInvoiceRevisionNo(
  tx: Prisma.TransactionClient,
  invoiceId: string,
): Promise<number> {
  const last = await tx.invoiceRevision.findFirst({
    where: { invoiceId, deletedAt: null },
    orderBy: { revisionNo: "desc" },
    select: { revisionNo: true },
  });
  return last?.revisionNo ?? 1;
}

/** 行金额算术（与 QuotationPricingService 公式一致，但不调用 Pricing Engine）：
 * lineAmount = unitPrice × quantity；taxAmount = lineAmount × taxRate / 100；totalAmount = lineAmount + taxAmount
 * 价格参数（unitPrice/discountRate/taxRate）100% 复制自溯源快照，不重新询价/不打折（Pricing 到 SO 为止）。
 */
export function computeInvoiceLineAmounts(params: {
  unitPrice: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  quantity: Prisma.Decimal;
}): { lineAmount: Prisma.Decimal; taxAmount: Prisma.Decimal; totalAmount: Prisma.Decimal } {
  const lineAmount = params.unitPrice.mul(params.quantity);
  const taxAmount = lineAmount.mul(params.taxRate).div(100);
  const totalAmount = lineAmount.add(taxAmount);
  return { lineAmount, taxAmount, totalAmount };
}
