import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission } from '@/lib/api-helpers';
import { ok } from '@/lib/api/response';
import { requestLog } from '@/lib/api/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ap-open-items/reconcile — AP Open Item 投影对账（只读运维工具，不改数据）
 *
 * 对每个 Open Item 重算 expected openAmount = Liability + Σsigned(CN/DN applied) − ΣAllocations(未 reversal)，
 * 与 ApOpenItem.openAmount 现值比对，输出 drift（inSync=false 表示投影与事实链不一致，需调查）。
 * 只读：不锁定、不写库；红线：不提供任何修正写端点（纠错走业务事实链）。
 * 过滤：supplierId / supplierInvoiceId。
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'ap-open-item:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'ap-open-item.reconcile');

  const { searchParams } = new URL(request.url);
  const supplierId = searchParams.get('supplierId')?.trim();
  const supplierInvoiceId = searchParams.get('supplierInvoiceId')?.trim();

  const where = {
    ...(supplierId ? { supplierId } : {}),
    ...(supplierInvoiceId ? { apLiabilityFact: { supplierInvoiceId } } : {}),
  };

  const openItems = await prisma.apOpenItem.findMany({
    where,
    include: {
      apLiabilityFact: { select: { id: true, supplierInvoiceId: true, grossAmount: true } },
    },
  });
  if (openItems.length === 0) return ok([]);

  const invoiceIds = [...new Set(openItems.map((oi) => oi.apLiabilityFact?.supplierInvoiceId).filter((x): x is string => Boolean(x)))];
  const openItemIds = openItems.map((oi) => oi.id);

  // 已 APPLIED 的 CN/DN（signed：CREDIT 负向 / DEBIT 正向）
  const cnDnNotes = await prisma.supplierCreditDebitNote.findMany({
    where: { sourceSupplierInvoiceId: { in: invoiceIds }, status: 'APPLIED', deletedAt: null },
    select: { sourceSupplierInvoiceId: true, noteType: true, adjustmentTotal: true },
  });
  // 未反转的核销行
  const allocations = await prisma.supplierPaymentAllocation.findMany({
    where: { apOpenItemId: { in: openItemIds }, reversedAt: null, deletedAt: null },
    select: { apOpenItemId: true, allocatedAmount: true },
  });

  const cnDnByInvoice = new Map<string, Prisma.Decimal>();
  for (const n of cnDnNotes) {
    const signed = n.noteType === 'CREDIT' ? new Prisma.Decimal(n.adjustmentTotal).negated() : new Prisma.Decimal(n.adjustmentTotal);
    cnDnByInvoice.set(n.sourceSupplierInvoiceId, (cnDnByInvoice.get(n.sourceSupplierInvoiceId) ?? new Prisma.Decimal(0)).add(signed));
  }
  const allocByOpenItem = new Map<string, Prisma.Decimal>();
  for (const a of allocations) {
    allocByOpenItem.set(a.apOpenItemId, (allocByOpenItem.get(a.apOpenItemId) ?? new Prisma.Decimal(0)).add(new Prisma.Decimal(a.allocatedAmount)));
  }

  const rows = openItems.map((oi) => {
    const liability = new Prisma.Decimal(oi.apLiabilityFact?.grossAmount.toString() ?? '0');
    const cnDn = cnDnByInvoice.get(oi.apLiabilityFact?.supplierInvoiceId ?? '') ?? new Prisma.Decimal(0);
    const alloc = allocByOpenItem.get(oi.id) ?? new Prisma.Decimal(0);
    const expected = liability.add(cnDn).sub(alloc);
    const actual = new Prisma.Decimal(oi.openAmount.toString());
    const drift = expected.sub(actual);
    return {
      id: oi.id,
      supplierId: oi.supplierId,
      supplierInvoiceId: oi.apLiabilityFact?.supplierInvoiceId ?? null,
      liability: liability.toFixed(4),
      cnDnSigned: cnDn.toFixed(4),
      allocations: alloc.toFixed(4),
      expectedOpenAmount: expected.toFixed(4),
      actualOpenAmount: actual.toFixed(4),
      drift: drift.toFixed(4),
      inSync: drift.eq(0),
    };
  });

  return ok(rows);
}