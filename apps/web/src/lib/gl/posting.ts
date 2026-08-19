import { Prisma } from '@prisma/client';

/**
 * Sprint 7 Finance 首块（CTO 解锁 2026-08-20，ADR-0033）：GL 过账服务
 * - postGlEntry：借贷平衡（Σdebit = Σcredit）/ 幂等（sourceType+sourceId @unique）/ 科目存在 / 取号 JRN
 * - glPostFromEvent：消费 5C 会计事件 → 自动过账分录（consumer handler 同事务调用）
 * 不变量：POSTED 一次性终态不可变；纠错 → 追加红字冲销；不手改已过账凭证。
 */

export type GlPostResult =
  | { ok: true; entryId: string; voucherNo: string; idempotent: boolean }
  | { ok: false; code: string; message: string; httpStatus: number };

export interface GlLineInput {
  accountCode: string; // GlAccount.code（seed 标准科目）
  debit: string | Prisma.Decimal; // 借方金额（Decimal 字符串/值）；>0 时 credit 必须为 0
  credit: string | Prisma.Decimal; // 贷方金额；>0 时 debit 必须为 0
  summary?: string;
  sourceRef?: string;
}

export interface GlPostParams {
  sourceType: string;
  sourceId: string;
  postingDate: Date;
  summary?: string;
  lines: GlLineInput[];
  actorId?: string | null;
}

/** DocumentSequence 原子取号（docType=JOURNAL，seed 已存在 JRN-2026-xxxx） */
async function nextGlVoucherNo(tx: Prisma.TransactionClient): Promise<string> {
  const seq = await tx.documentSequence.findFirst({
    where: { docType: 'JOURNAL' as never, isActive: true, deletedAt: null },
  });
  if (!seq) throw new Error('JOURNAL_SEQUENCE_MISSING');
  const updated = await tx.documentSequence.update({
    where: { id: seq.id },
    data: { nextNo: { increment: 1 } },
  });
  return `${seq.prefix}${String(updated.nextNo - 1).padStart(seq.padLength, '0')}`;
}

/** 科目 code → id（fail closed：科目缺失即拒绝过账，不静默降级） */
async function resolveAccountId(tx: Prisma.TransactionClient, code: string): Promise<string> {
  const acc = await tx.glAccount.findFirst({ where: { code, deletedAt: null }, select: { id: true } });
  if (!acc) throw new Error('GL_ACCOUNT_MISSING:' + code);
  return acc.id;
}

/**
 * 过账服务：创建记账凭证头 + 行（同事务）。
 * 校验：借贷平衡（Decimal 精确）/ 每行恰一侧 > 0 / 科目存在 / 幂等（sourceType+sourceId 已存在 → 幂等跳过）。
 */
export async function postGlEntry(tx: Prisma.TransactionClient, params: GlPostParams): Promise<GlPostResult> {
  const existing = await tx.glJournalEntry.findFirst({
    where: { sourceType: params.sourceType, sourceId: params.sourceId, deletedAt: null },
    select: { id: true, voucherNo: true },
  });
  if (existing) return { ok: true, entryId: existing.id, voucherNo: existing.voucherNo, idempotent: true };

  const rows = await Promise.all(
    params.lines.map(async (l) => {
      const debit = new Prisma.Decimal(l.debit).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const credit = new Prisma.Decimal(l.credit).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      if (debit.isNegative() || credit.isNegative()) throw new Error('GL_NEGATIVE_AMOUNT');
      if (debit.gt(0) && credit.gt(0)) throw new Error('GL_BOTH_SIDES');
      if (debit.eq(0) && credit.eq(0)) throw new Error('GL_ZERO_AMOUNT');
      const accountId = await resolveAccountId(tx, l.accountCode);
      return { accountId, debit, credit, summary: l.summary, sourceRef: l.sourceRef };
    }),
  );

  // 借贷平衡（服务端 Decimal 精确）
  const totalDebit = rows.reduce((acc, r) => acc.add(r.debit), new Prisma.Decimal(0));
  const totalCredit = rows.reduce((acc, r) => acc.add(r.credit), new Prisma.Decimal(0));
  if (!totalDebit.eq(totalCredit)) {
    return { ok: false, code: 'GL_UNBALANCED', message: '借贷不平衡（借方 ' + totalDebit.toFixed(2) + ' ≠ 贷方 ' + totalCredit.toFixed(2) + '），拒绝过账', httpStatus: 409 };
  }

  const voucherNo = await nextGlVoucherNo(tx);
  const entry = await tx.glJournalEntry.create({
    data: {
      voucherNo,
      postingDate: params.postingDate,
      status: 'POSTED',
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      summary: params.summary,
      createdById: params.actorId ?? null,
      postedById: params.actorId ?? null,
      postedAt: new Date(),
      lines: { create: rows },
    },
    include: { lines: true },
  });
  return { ok: true, entryId: entry.id, voucherNo, idempotent: false };
}

/**
 * 消费 5C 会计事件 → GL 分录（ADR-0033 账务规则；consumer handler 在 Outbox PROCESSED 同事务调用）
 * 事件 → 分录：
 * - SupplierInvoicePosted：借 采购成本(1403, net+nonRecoverable) + 借 进项税(222101, inputVat) 贷 应付账款(2202, gross)
 * - SupplierPaymentApplied：借 应付账款(2202) 贷 银行存款(1002, allocatedAmount)
 * - SupplierCreditDebitNoteApplied（CREDIT）：借 应付账款(2202) 贷 采购调整(6111, adjustmentTotal)
 * - SupplierCreditDebitNoteApplied（DEBIT）：借 采购调整(6111) 贷 应付账款(2202, adjustmentTotal)
 * - SupplierPaymentReversed：借 银行存款(1002) 贷 应付账款(2202, reversedAllocations 金额合计)
 * 幂等：GlJournalEntry @@unique(sourceType, sourceId)（重复消费 → postGlEntry 幂等跳过）。
 */
export async function glPostFromEvent(
  tx: Prisma.TransactionClient,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<GlPostResult> {
  switch (eventType) {
    case 'SupplierInvoicePosted': {
      const gross = String(payload.grossAmount ?? '0');
      const net = String(payload.netAmount ?? '0');
      const inputVat = String(payload.inputVatAmount ?? '0');
      const nonRecoverable = String(payload.nonRecoverableTaxAmount ?? '0');
      const purchase = new Prisma.Decimal(net).add(new Prisma.Decimal(nonRecoverable)).toFixed(2);
      return postGlEntry(tx, {
        sourceType: 'SupplierInvoicePosted',
        sourceId: String(payload.invoiceId),
        postingDate: payload.postedAt ? new Date(String(payload.postedAt)) : new Date(),
        summary: '供应商发票过账：' + String(payload.invoiceNo ?? ''),
        lines: [
          { accountCode: '1403', debit: purchase, credit: '0', summary: '采购成本（含不可抵扣税）', sourceRef: String(payload.invoiceId) },
          { accountCode: '222101', debit: inputVat, credit: '0', summary: '进项税额', sourceRef: String(payload.invoiceId) },
          { accountCode: '2202', debit: '0', credit: gross, summary: '应付账款', sourceRef: String(payload.invoiceId) },
        ],
        actorId: payload.postedById ? String(payload.postedById) : null,
      });
    }
    case 'SupplierPaymentApplied': {
      const amount = String(payload.allocatedAmount ?? '0');
      return postGlEntry(tx, {
        sourceType: 'SupplierPaymentApplied',
        sourceId: String(payload.paymentId) + '|' + String(payload.apOpenItemId),
        postingDate: payload.allocatedAt ? new Date(String(payload.allocatedAt)) : new Date(),
        summary: '付款核销：' + String(payload.code ?? ''),
        lines: [
          { accountCode: '2202', debit: amount, credit: '0', summary: '冲减应付账款', sourceRef: String(payload.paymentId) },
          { accountCode: '1002', debit: '0', credit: amount, summary: '银行存款', sourceRef: String(payload.paymentId) },
        ],
        actorId: payload.allocatedById ? String(payload.allocatedById) : null,
      });
    }
    case 'SupplierCreditDebitNoteApplied': {
      const noteType = String(payload.noteType ?? 'CREDIT');
      const total = String(payload.adjustmentTotal ?? '0');
      const abs = new Prisma.Decimal(total).abs().toFixed(2);
      if (noteType === 'CREDIT') {
        return postGlEntry(tx, {
          sourceType: 'SupplierCreditDebitNoteApplied',
          sourceId: String(payload.cnDnId),
          postingDate: payload.appliedAt ? new Date(String(payload.appliedAt)) : new Date(),
          summary: '供应商贷项应用：' + String(payload.code ?? ''),
          lines: [
            { accountCode: '2202', debit: abs, credit: '0', summary: '冲减应付账款', sourceRef: String(payload.cnDnId) },
            { accountCode: '6111', debit: '0', credit: abs, summary: '采购调整（贷项）', sourceRef: String(payload.cnDnId) },
          ],
          actorId: payload.appliedById ? String(payload.appliedById) : null,
        });
      }
      return postGlEntry(tx, {
        sourceType: 'SupplierCreditDebitNoteApplied',
        sourceId: String(payload.cnDnId),
        postingDate: payload.appliedAt ? new Date(String(payload.appliedAt)) : new Date(),
        summary: '供应商借项应用：' + String(payload.code ?? ''),
        lines: [
          { accountCode: '6111', debit: abs, credit: '0', summary: '采购调整（借项）', sourceRef: String(payload.cnDnId) },
          { accountCode: '2202', debit: '0', credit: abs, summary: '增加应付账款', sourceRef: String(payload.cnDnId) },
        ],
        actorId: payload.appliedById ? String(payload.appliedById) : null,
      });
    }
    case 'GrirAccrued': {
      // 暂估应付（GRIR ACCRUAL）：借 原材料(1403) 贷 应付账款-暂估(2203)；按行 baseAmount 合计（未税暂估净额）
      const accruedLines = (payload.accruedLines ?? []) as Array<{ baseAmount: string }>;
      const total = accruedLines.reduce((acc, l) => acc.add(new Prisma.Decimal(l.baseAmount ?? '0')), new Prisma.Decimal(0));
      return postGlEntry(tx, {
        sourceType: 'GrirAccrued',
        sourceId: String(payload.warehouseReceiptId),
        postingDate: payload.accruedAt ? new Date(String(payload.accruedAt)) : new Date(),
        summary: '采购入库暂估：' + String(payload.warehouseReceiptCode ?? ''),
        lines: [
          { accountCode: '1403', debit: total.toFixed(2), credit: '0', summary: '暂估入库（原材料）', sourceRef: String(payload.warehouseReceiptId) },
          { accountCode: '2203', debit: '0', credit: total.toFixed(2), summary: '应付账款-暂估（GRIR）', sourceRef: String(payload.warehouseReceiptId) },
        ],
        actorId: payload.accruedById ? String(payload.accruedById) : null,
      });
    }
    case 'GrirReversed': {
      // 冲减暂估（GRIR REVERSAL）：借 应付账款-暂估(2203) 贷 原材料(1403)；反向红字（按行 baseAmount 合计）
      const reversedLines = (payload.reversedLines ?? []) as Array<{ baseAmount: string }>;
      const total = reversedLines.reduce((acc, l) => acc.add(new Prisma.Decimal(l.baseAmount ?? '0')), new Prisma.Decimal(0));
      return postGlEntry(tx, {
        sourceType: 'GrirReversed',
        sourceId: String(payload.purchaseReturnId),
        postingDate: payload.reversedAt ? new Date(String(payload.reversedAt)) : new Date(),
        summary: '采购退货冲减暂估：' + String(payload.purchaseReturnCode ?? ''),
        lines: [
          { accountCode: '2203', debit: total.toFixed(2), credit: '0', summary: '冲减应付账款-暂估', sourceRef: String(payload.purchaseReturnId) },
          { accountCode: '1403', debit: '0', credit: total.toFixed(2), summary: '冲减暂估入库（原材料）', sourceRef: String(payload.purchaseReturnId) },
        ],
        actorId: payload.reversedById ? String(payload.reversedById) : null,
      });
    }
    case 'SupplierPaymentReversed': {
      // 反转核销金额合计（从业务事实读取：付款单未反转核销行的 reversed 金额——事件载荷只有数量）
      const amount = await totalReversedAllocations(tx, String(payload.paymentId));
      return postGlEntry(tx, {
        sourceType: 'SupplierPaymentReversed',
        sourceId: String(payload.paymentId),
        postingDate: payload.reversedAt ? new Date(String(payload.reversedAt)) : new Date(),
        summary: '付款冲销：' + String(payload.code ?? ''),
        lines: [
          { accountCode: '1002', debit: amount, credit: '0', summary: '冲销付款（银行存款回补）', sourceRef: String(payload.paymentId) },
          { accountCode: '2202', debit: '0', credit: amount, summary: '恢复应付账款', sourceRef: String(payload.paymentId) },
        ],
        actorId: payload.reversedById ? String(payload.reversedById) : null,
      });
    }
    default:
      return { ok: false, code: 'UNSUPPORTED_EVENT', message: 'GL 未注册该事件类型：' + eventType, httpStatus: 409 };
  }
}

/** 付款冲销金额合计：本付款单所有已反转核销行的 allocatedAmount 总和（业务事实，不信任事件载荷数字） */
async function totalReversedAllocations(tx: Prisma.TransactionClient, paymentId: string): Promise<string> {
  const rows = await tx.supplierPaymentAllocation.findMany({
    where: { paymentId, reversedAt: { not: null }, deletedAt: null },
    select: { allocatedAmount: true },
  });
  const total = rows.reduce((acc, r) => acc.add(r.allocatedAmount), new Prisma.Decimal(0));
  return total.toFixed(2);
}