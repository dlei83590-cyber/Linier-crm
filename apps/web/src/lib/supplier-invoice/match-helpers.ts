import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { verifyReceiptBasedSourceChain } from '@/lib/supplier-invoice/helpers';

/**
 * Sprint 5C-1B - Immutable 3-Way Match 领域通用函数（Match Engine——CTO #9238/#9247 分层指令）
 * 设计依据：Sprint5C_Supplier_Invoice_Three_Way_Match_AP_Gate.md §4.4-4.13 + Field Matrix §2.1-2.2 +
 *           ADR-0027 + CTO #9238（Match/Approval 分层）+ #9247（3 细节锁死）
 * - **每次 Match 创建新 SupplierInvoiceMatchRun**：revision = 当前最大 revision + 1（header lock 内计算），
 *   每发票行创建 immutable MatchLine；**禁止 UPDATE/DELETE 历史 Run/Line**（DB immutable trigger 最终防线）
 * - **并发 revision 以 SupplierInvoice header lock 为唯一串行点**（#9247）：
 *   锁 invoice → 重读状态/current run → 算 next revision → 来源链重验 → 生成 Run/Lines →
 *   更新 current projection → CAS 状态到 MATCHED；**不单独锁 MatchRun 表，不把 MAX+1 放锁前**
 * - **re-match 门禁**（#9247）：SUBMITTED → MATCHED；MATCHED → MATCHED(new revision)；
 *   APPROVED/POSTED/CANCELLED → 禁直接 re-match（MATCH_NOT_MATCHABLE）
 * - **Match 时重新执行来源事实 Gate**（WHR POSTED + 链一致 + Item ACTIVE + 累计守恒——复用
 *   verifyReceiptBasedSourceChain，含确定性 WHR Line lock order）
 * - **snapshot 全部服务端生成**：poQty/receiptQty/invoiceQty/poUnitPrice/invoiceUnitPrice/
 *   qtyVariance/priceVariance/taxVariance/result/disposition——客户端不得上传计算结果
 * - **current projection 与 immutable history 分离**：Match 成功后才更新 header.currentMatchRunId +
 *   lines currentMatchRunId/currentMatchStatus/matchedQty/variance*（投影可更新；历史依据永远是 Run/Line）
 * - **Match API 自己不得写 approvedMatchRunId/approvedMatchRevision**（Approval 单独接 Workflow——#9238）
 * - 红线：不创建 GrirRecord/ApLiabilityFact/ApOpenItem；不写 postedAt/postedById；不接 CN/DN（CREATE_CN_DN 5C-2）
 */

/** Match 事务结果（错误码映射到 SUPPLIER_INVOICE_* 路由层） */
type MatchRunWithLines = NonNullable<
  Awaited<
    ReturnType<
      typeof prisma.supplierInvoiceMatchRun.findFirst<{
        include: { lines: { orderBy: { createdAt: 'asc' } } };
      }>
    >
  >
>;

export type MatchResult =
  | { ok: true; run: MatchRunWithLines; invoice: NonNullable<Awaited<ReturnType<typeof prisma.supplierInvoice.findFirst>>> }
  | {
      ok: false;
      error:
        | 'NOT_FOUND'
        | 'NOT_MATCHABLE' // APPROVED/POSTED/CANCELLED 禁直接 re-match（#9247）
        | 'VERSION_CONFLICT'
        | 'NO_LINES'
        | 'WHR_NOT_POSTED'
        | 'SOURCE_CHAIN_MISMATCH'
        | 'ITEM_INVALID'
        | 'QUANTITY_INVALID'
        | 'CUMULATIVE_QTY_EXCEEDED';
      status?: string;
    };

/**
 * **Match Engine（唯一入口）**：SUBMITTED/MATCHED → MATCHED（追加 immutable revision）
 * 事务内顺序（CTO #9247 锁死）：
 * ① FOR UPDATE 锁 SupplierInvoice header（**唯一串行点**）
 * ② 重读状态/current run → 状态门禁（SUBMITTED/MATCHED 可进；APPROVED/POSTED/CANCELLED 禁）→ CAS version
 * ③ 锁内算 next revision（max(revision)+1——header lock 保证并发唯一）
 * ④ 来源链重验（verifyReceiptBasedSourceChain 复用：WHR POSTED + 链一致 + Item ACTIVE + 累计守恒）
 * ⑤ 服务端 snapshot 计算（三单数量/单价/税额差异 + result/disposition）
 * ⑥ 创建 MatchRun + MatchLines（immutable）
 * ⑦ 更新 current projection（header.currentMatchRunId + lines currentMatchRunId/currentMatchStatus/matchedQty/variance*）
 * ⑧ CAS documentStatus → MATCHED（version+1）
 * 全部同一 caller transaction（调用方 prisma.$transaction）。
 */
export async function runMatch(
  tx: Prisma.TransactionClient,
  params: { invoiceId: string; version: number; actorId: string },
): Promise<MatchResult> {
  // ① Lock SupplierInvoice header（FOR UPDATE——唯一串行点，防并发 revision 双计）
  const locked = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "SupplierInvoice" WHERE "id" = ${params.invoiceId} AND "deletedAt" IS NULL FOR UPDATE`,
  );
  if (locked.length === 0) return { ok: false, error: 'NOT_FOUND' };

  // ② 重读状态/current run + CAS version
  const invoice = await tx.supplierInvoice.findFirst({
    where: { id: params.invoiceId, deletedAt: null },
    select: { id: true, documentStatus: true, version: true, supplierId: true, currentMatchRunId: true },
  });
  if (!invoice) return { ok: false, error: 'NOT_FOUND' };
  // 状态门禁（#9247）：SUBMITTED/MATCHED 可进；APPROVED/POSTED/CANCELLED 禁直接 re-match
  if (invoice.documentStatus !== 'SUBMITTED' && invoice.documentStatus !== 'MATCHED') {
    return { ok: false, error: 'NOT_MATCHABLE', status: invoice.documentStatus };
  }
  if (invoice.version !== params.version) return { ok: false, error: 'VERSION_CONFLICT' };

  // ③ 锁内算 next revision（max+1——header lock 保证并发唯一，不单独锁 MatchRun 表）
  const maxAgg = await tx.supplierInvoiceMatchRun.aggregate({
    where: { supplierInvoiceId: params.invoiceId },
    _max: { revision: true },
  });
  const nextRevision = (maxAgg._max.revision ?? 0) + 1;

  // ④ 发票行（含双溯源）+ 来源链重验（复用 5C-1A helper：WHR POSTED + 链一致 + Item ACTIVE + 累计守恒）
  const lines = await tx.supplierInvoiceLine.findMany({
    where: { supplierInvoiceId: params.invoiceId, deletedAt: null },
    orderBy: { lineNo: 'asc' },
  });
  if (lines.length === 0) return { ok: false, error: 'NO_LINES' };

  // ④b 来源事实 Gate（#9238：不信任 5C-1A Submit 结果，Match 时重新验证）
  const chain = await verifyReceiptBasedSourceChain(tx, {
    supplierId: invoice.supplierId,
    excludeInvoiceId: params.invoiceId, // Match 时自身行已在 DB（DRAFT 状态行排除自身累计占用）
    lines: lines.map((l) => ({
      purchaseOrderLineId: l.purchaseOrderLineId,
      warehouseReceiptLineId: l.warehouseReceiptLineId,
      quantity: l.quantity,
    })),
  });
  if (!chain.ok) return { ok: false, error: chain.error };

  // ⑤ 服务端 snapshot 计算（全部服务端生成——客户端不得上传计算结果）
  const matchLines: Array<{
    supplierInvoiceLineId: string;
    purchaseOrderLineId: string;
    warehouseReceiptLineId: string;
    poQty: Prisma.Decimal;
    receiptQty: Prisma.Decimal;
    invoiceQty: Prisma.Decimal;
    poUnitPrice: Prisma.Decimal;
    invoiceUnitPrice: Prisma.Decimal;
    qtyVariance: Prisma.Decimal;
    priceVariance: Prisma.Decimal;
    taxVariance: Prisma.Decimal;
    matchedQty: Prisma.Decimal;
    result: 'MATCHED' | 'VARIANCE';
    disposition: 'ACCEPT' | 'HOLD';
  }> = [];

  for (const line of lines) {
    // 快照源：PO Line（poQty/poUnitPrice）+ WHR Line（receiptQty）+ Invoice Line（invoiceQty/invoiceUnitPrice/taxAmount）
    const poLine = await tx.purchaseOrderLine.findFirst({
      where: { id: line.purchaseOrderLineId, deletedAt: null },
      select: { quantity: true, unitPrice: true },
    });
    const whrLine = await tx.warehouseReceiptLine.findFirst({
      where: { id: line.warehouseReceiptLineId, deletedAt: null },
      select: { quantity: true },
    });
    if (!poLine || !whrLine) return { ok: false, error: 'SOURCE_CHAIN_MISMATCH' };

    const poQty = poLine.quantity;
    const receiptQty = whrLine.quantity;
    const invoiceQty = line.quantity;
    const poUnitPrice = poLine.unitPrice;
    const invoiceUnitPrice = line.unitPrice;

    // 数量匹配（4.4）：invoiceQty vs min(poQty, receiptQty) 可用额；超过已收数量部分不可入 AP
    const availableQty = Prisma.Decimal.min(poQty, receiptQty);
    const matchedQty = Prisma.Decimal.min(invoiceQty, availableQty);
    const qtyVariance = invoiceQty.sub(matchedQty).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

    // 单价差异（4.6）：invoiceUnitPrice vs PO 快照
    const priceVariance = invoiceUnitPrice.sub(poUnitPrice).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);

    // 税额差异（4.7）：invoiceTax vs 服务端计算税（税率快照自 PO；税基 = 匹配净额 = matchedQty × poUnitPrice）
    const expectedTax = matchedQty.mul(poUnitPrice).mul(line.taxRate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const taxVariance = line.taxAmount.sub(expectedTax).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    // 行 result/disposition：全零差异 → MATCHED/ACCEPT；任一差异 → VARIANCE/HOLD（触发审批；CREATE_CN_DN 5C-2 不接）
    const isClean = qtyVariance.isZero() && priceVariance.isZero() && taxVariance.isZero();
    matchLines.push({
      supplierInvoiceLineId: line.id,
      purchaseOrderLineId: line.purchaseOrderLineId,
      warehouseReceiptLineId: line.warehouseReceiptLineId,
      poQty,
      receiptQty,
      invoiceQty,
      poUnitPrice,
      invoiceUnitPrice,
      qtyVariance,
      priceVariance,
      taxVariance,
      matchedQty,
      result: isClean ? 'MATCHED' : 'VARIANCE',
      disposition: isClean ? 'ACCEPT' : 'HOLD',
    });
  }

  // 头级 result/disposition
  const headerClean = matchLines.every((m) => m.result === 'MATCHED');
  const headerResult = headerClean ? 'MATCHED' : 'VARIANCE';
  const headerDisposition = headerClean ? 'ACCEPT' : 'HOLD';

  // ⑥ 创建 MatchRun + MatchLines（immutable——DB trigger 禁止后续 UPDATE/DELETE）
  const run = await tx.supplierInvoiceMatchRun.create({
    data: {
      supplierInvoiceId: params.invoiceId,
      runNo: nextRevision,
      revision: nextRevision,
      runById: params.actorId,
      result: headerResult,
      disposition: headerDisposition,
      createdById: params.actorId,
      lines: {
        create: matchLines.map((m) => ({
          supplierInvoiceLineId: m.supplierInvoiceLineId,
          purchaseOrderLineId: m.purchaseOrderLineId,
          warehouseReceiptLineId: m.warehouseReceiptLineId,
          poQty: m.poQty,
          receiptQty: m.receiptQty,
          invoiceQty: m.invoiceQty,
          poUnitPrice: m.poUnitPrice,
          invoiceUnitPrice: m.invoiceUnitPrice,
          qtyVariance: m.qtyVariance,
          priceVariance: m.priceVariance,
          taxVariance: m.taxVariance,
          result: m.result,
          disposition: m.disposition,
          createdById: params.actorId,
        })),
      },
    },
    include: {
      lines: { orderBy: { createdAt: 'asc' } },
    },
  });

  // ⑦ 更新 current projection（header + lines——投影可更新，历史依据永远是 Run/Line）
  await tx.supplierInvoice.update({
    where: { id: params.invoiceId },
    data: { currentMatchRunId: run.id, updatedById: params.actorId },
  });
  for (const m of matchLines) {
    await tx.supplierInvoiceLine.update({
      where: { id: m.supplierInvoiceLineId },
      data: {
        currentMatchRunId: run.id,
        currentMatchStatus: m.result,
        matchedQty: m.matchedQty,
        varianceQty: m.qtyVariance,
        variancePrice: m.priceVariance,
        varianceTax: m.taxVariance,
        updatedById: params.actorId,
      },
    });
  }

  // ⑧ CAS 状态：SUBMITTED/MATCHED → MATCHED（version+1）
  const cas = await tx.supplierInvoice.updateMany({
    where: { id: params.invoiceId, version: params.version, documentStatus: { in: ['SUBMITTED', 'MATCHED'] }, deletedAt: null },
    data: { documentStatus: 'MATCHED', version: { increment: 1 }, updatedById: params.actorId },
  });
  if (cas.count !== 1) return { ok: false, error: 'VERSION_CONFLICT' };

  const invoiceFinal = await tx.supplierInvoice.findFirst({
    where: { id: params.invoiceId, deletedAt: null },
    include: {
      lines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } },
    },
  });
  if (!invoiceFinal) return { ok: false, error: 'NOT_FOUND' };

  return { ok: true, run, invoice: invoiceFinal };
}
