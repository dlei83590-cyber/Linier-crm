import { Prisma } from '@prisma/client';

export type SupplierCnDnApplyResult =
  | { ok: true; openAmountsAfter: Array<{ supplierInvoiceId: string; openAmountAfter: string }> }
  | { ok: false; code: string; message: string; httpStatus: number };

interface LockedCnDnRow {
  id: string;
  code: string;
  noteType: string;
  sourceSupplierInvoiceId: string | null;
  supplierId: string;
  currency: string;
  adjustmentTotal: string;
  status: string;
  version: number;
  createdById: string | null;
}

interface LockedOpenItemRow {
  id: string;
  apLiabilityFactId: string;
  openAmount: string;
  supplierInvoiceId: string;
}

interface LineWithInvoiceRow {
  lineId: string;
  amount: string;
  supplierInvoiceId: string;
}

/**
 * 5C-2 Supplier CN/DN APPLY（ADR-0027 D6，跨票 Consolidated 0032）：APPROVED → APPLIED，
 * 同事务重算涉及发票的 ApOpenItem.openAmount 投影。
 *
 * 跨票语义（Migration 0032）：一张 CN/DN 可调整多张 POSTED 发票（同供应商同币种）；
 * 调整金额按行归属分摊——每行 line.sourceSupplierInvoiceLineId → 所属发票，各票 signed 汇总。
 *
 * 不变量：
 * - 锁序（Blocking Gate）：先锁 CN/DN 头 FOR UPDATE → collect 全部涉及发票的 Open Item ids
 *   → dedupe → sort → `SELECT ... ORDER BY id FOR UPDATE`（与 Payment apply 完全一致，防死锁）
 * - 逐票防超调：任一发票 CREDIT（负向）后 openAmount < 0 → 409（负 AP 防线）
 * - maker-checker：appliedById ≠ createdById（硬性）；已 APPLIED → 幂等 409
 * - 不可变事实：CN/DN 自身 APPLIED 后禁改；纠错 → 追加反向 CN/DN
 * 调用方必须已处于 prisma.$transaction 内。
 */
export async function applySupplierCnDn(
  tx: Prisma.TransactionClient,
  params: { cnDnId: string; version: number; actorId: string },
): Promise<SupplierCnDnApplyResult> {
  const rows = await tx.$queryRaw<LockedCnDnRow[]>(
    Prisma.sql`SELECT "id", "code", "noteType", "sourceSupplierInvoiceId", "supplierId", "currency", "adjustmentTotal", "status", "version", "createdById" FROM "SupplierCreditDebitNote" WHERE "id" = ${params.cnDnId} AND "deletedAt" IS NULL FOR UPDATE`,
  );
  const note = rows[0];
  if (!note) return { ok: false, code: 'NOT_FOUND', message: '供应商贷/借项通知单不存在', httpStatus: 404 };
  if (note.status === 'APPLIED') return { ok: false, code: 'ALREADY_APPLIED', message: '通知单已应用（APPLIED），重复 APPLY 幂等拒绝', httpStatus: 409 };
  if (note.status !== 'APPROVED') return { ok: false, code: 'INVALID_STATE', message: '仅 APPROVED 状态可应用（当前 ' + note.status + '）；APPROVED ≠ APPLIED', httpStatus: 409 };
  if (note.version !== params.version) return { ok: false, code: 'VERSION_CONFLICT', message: '版本冲突，请刷新后重试', httpStatus: 409 };
  if (note.createdById === params.actorId) return { ok: false, code: 'MAKER_CHECKER', message: '应用人不能是创建人（maker-checker）', httpStatus: 409 };

  // 关联发票集合（Migration 0032 回填后统一从关联表读取；防御：空则退化单票 sourceSupplierInvoiceId）
  const linkRows = await tx.$queryRaw<{ supplierInvoiceId: string }[]>(
    Prisma.sql`SELECT "supplierInvoiceId" FROM "SupplierCreditDebitNoteInvoice" WHERE "creditDebitNoteId" = ${params.cnDnId}`,
  );
  let invoiceIds = [...new Set(linkRows.map((l) => l.supplierInvoiceId))];
  if (invoiceIds.length === 0 && note.sourceSupplierInvoiceId) invoiceIds = [note.sourceSupplierInvoiceId];

  // 行归属分摊：每行 → 所属发票，按发票 signed 汇总（服务端 Decimal；不信任头金额分摊）
  const lineRows = await tx.$queryRaw<LineWithInvoiceRow[]>(
    Prisma.sql`SELECT l."sourceSupplierInvoiceLineId" AS "lineId", l."amount", il."supplierInvoiceId" FROM "SupplierCreditDebitNoteLine" l JOIN "SupplierInvoiceLine" il ON il."id" = l."sourceSupplierInvoiceLineId" WHERE l."creditDebitNoteId" = ${params.cnDnId}`,
  );
  if (lineRows.length === 0) return { ok: false, code: 'NO_LINES', message: '通知单无明细行，禁止应用', httpStatus: 409 };

  const signedByInvoice = new Map<string, Prisma.Decimal>();
  for (const lr of lineRows) {
    const signed = note.noteType === 'CREDIT' ? new Prisma.Decimal(lr.amount).negated() : new Prisma.Decimal(lr.amount);
    signedByInvoice.set(lr.supplierInvoiceId, (signedByInvoice.get(lr.supplierInvoiceId) ?? new Prisma.Decimal(0)).add(signed));
  }
  // 行归属发票必须 ⊆ 关联发票集合（防不一致数据）
  const lineInvoiceIds = [...signedByInvoice.keys()];
  for (const lid of lineInvoiceIds) {
    if (!invoiceIds.includes(lid)) return { ok: false, code: 'LINE_INVOICE_MISMATCH', message: '明细行归属发票不在关联集合内，数据不一致', httpStatus: 409 };
  }

  // 锁全部涉及发票的 Open Item：collect ids → dedupe → sort → ORDER BY id FOR UPDATE（单查询 join 带出 invoiceId，顺序天然一致）
  const openItems = await tx.$queryRaw<LockedOpenItemRow[]>(
    Prisma.sql`SELECT oi."id", oi."apLiabilityFactId", oi."openAmount", lf."supplierInvoiceId" FROM "ApOpenItem" oi JOIN "ApLiabilityFact" lf ON lf."id" = oi."apLiabilityFactId" WHERE lf."supplierInvoiceId" IN (${Prisma.join(invoiceIds)}) ORDER BY oi."id" FOR UPDATE`,
  );
  if (openItems.length !== invoiceIds.length) {
    return { ok: false, code: 'OPEN_ITEM_NOT_FOUND', message: '存在未过账发票（无 AP Open Item），拒绝应用', httpStatus: 409 };
  }
  const openItemByInvoice = new Map<string, LockedOpenItemRow>();
  for (const oi of openItems) openItemByInvoice.set(oi.supplierInvoiceId, oi);

  // 逐票重算 + 逐票防超调（任一票 CREDIT 后 < 0 → 409）
  const nextByInvoice = new Map<string, Prisma.Decimal>();
  for (const [invoiceId, signed] of signedByInvoice) {
    const openItem = openItemByInvoice.get(invoiceId);
    if (!openItem) return { ok: false, code: 'OPEN_ITEM_NOT_FOUND', message: '目标 AP Open Item 不存在（发票未过账？）', httpStatus: 409 };
    const next = new Prisma.Decimal(openItem.openAmount).add(signed);
    if (next.isNegative()) {
      return { ok: false, code: 'OVER_ADJUSTMENT', message: '存在发票累计调整后应付未结项为负（CREDIT 超冲减），拒绝应用', httpStatus: 409 };
    }
    nextByInvoice.set(invoiceId, next);
  }

  // 同事务：投影重算（逐票）+ 状态终态（failure atomicity）
  for (const [invoiceId, next] of nextByInvoice) {
    const openItem = openItemByInvoice.get(invoiceId)!;
    await tx.apOpenItem.update({
      where: { id: openItem.id },
      data: { openAmount: next, updatedAt: new Date() },
    });
  }
  await tx.supplierCreditDebitNote.update({
    where: { id: note.id },
    data: { status: 'APPLIED', appliedAt: new Date(), appliedById: params.actorId, version: { increment: 1 } },
  });

  const openAmountsAfter = [...nextByInvoice.entries()].map(([supplierInvoiceId, v]) => ({
    supplierInvoiceId,
    openAmountAfter: v.toFixed(4),
  }));
  return { ok: true, openAmountsAfter };
}