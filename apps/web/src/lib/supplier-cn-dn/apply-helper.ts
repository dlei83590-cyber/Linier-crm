import { Prisma } from '@prisma/client';

export type SupplierCnDnApplyResult =
  | { ok: true; openAmountAfter: string }
  | { ok: false; code: string; message: string; httpStatus: number };

interface LockedCnDnRow {
  id: string;
  code: string;
  noteType: string;
  sourceSupplierInvoiceId: string;
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
}

/**
 * 5C-2 Supplier CN/DN APPLY（ADR-0027 D6）：APPROVED → APPLIED，同事务重算 ApOpenItem.openAmount 投影。
 * 不变量：
 * - 锁序（Blocking Gate）：先锁 CN/DN 头 FOR UPDATE → 再锁目标 ApOpenItem FOR UPDATE（与 Payment apply 一致：业务头 → openItem）
 * - 防超调：CREDIT（负向）后 openAmount ≥ 0（累计锁内重算，超限 409）
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

  // 锁目标 ApOpenItem（经 ApLiabilityFact.supplierInvoiceId 定位；与 Payment apply 同一锁序：业务头 → openItem）
  const items = await tx.$queryRaw<LockedOpenItemRow[]>(
    Prisma.sql`SELECT "id", "apLiabilityFactId", "openAmount" FROM "ApOpenItem" WHERE "apLiabilityFactId" IN (SELECT "id" FROM "ApLiabilityFact" WHERE "supplierInvoiceId" = ${note.sourceSupplierInvoiceId}) FOR UPDATE`,
  );
  const openItem = items[0];
  if (!openItem) return { ok: false, code: 'OPEN_ITEM_NOT_FOUND', message: '目标 AP Open Item 不存在（发票未过账？）', httpStatus: 409 };

  const signed = note.noteType === 'CREDIT' ? new Prisma.Decimal(note.adjustmentTotal).negated() : new Prisma.Decimal(note.adjustmentTotal);
  const current = new Prisma.Decimal(openItem.openAmount);
  const next = current.add(signed);
  if (next.isNegative()) {
    return { ok: false, code: 'OVER_ADJUSTMENT', message: '累计调整后应付未结项为负（CREDIT 超冲减），拒绝应用', httpStatus: 409 };
  }

  // 同事务：投影重算 + 状态终态（failure atomicity）
  await tx.apOpenItem.update({
    where: { id: openItem.id },
    data: { openAmount: next, updatedAt: new Date() },
  });
  await tx.supplierCreditDebitNote.update({
    where: { id: note.id },
    data: { status: 'APPLIED', appliedAt: new Date(), appliedById: params.actorId, version: { increment: 1 } },
  });

  return { ok: true, openAmountAfter: next.toFixed(4) };
}