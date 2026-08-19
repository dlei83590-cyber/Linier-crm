import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, failValidation, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/supplier-credit-debit-notes/:id/submit — DRAFT → SUBMITTED（5C-2）
 * 第三次来源链校验：全部行仍属于来源 POSTED 发票 + adjustmentTotal > 0；不创建任何会计事实（APPLY 属 apply 端点）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'supplier-credit-debit-note:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'supplier-credit-debit-note.submit');

  const { id } = await params;
  const meta = requestMeta(request);
  const body = (await request.json().catch(() => null)) as { version?: number } | null;
  const version = typeof body?.version === 'number' ? body.version : null;
  if (!version) return failValidation({ version: '缺少 version' });

  try {
    const submitted = await prisma.$transaction(async (tx) => {
      const note = await tx.supplierCreditDebitNote.findFirst({
        where: { id, deletedAt: null },
        include: { lines: true },
      });
      if (!note) throw new Error('NOT_FOUND');
      if (note.status !== 'DRAFT') throw new Error('INVALID_STATE');
      if (note.version !== version) throw new Error('VERSION_CONFLICT');

      const sourceInvoice = await tx.supplierInvoice.findFirst({
        where: { id: note.sourceSupplierInvoiceId, deletedAt: null },
        select: { documentStatus: true },
      });
      if (!sourceInvoice || sourceInvoice.documentStatus !== 'POSTED') throw new Error('SOURCE_NOT_POSTED');

      const lineIds = note.lines.map((l) => l.sourceSupplierInvoiceLineId);
      const validLines = await tx.supplierInvoiceLine.count({
        where: { id: { in: lineIds }, supplierInvoiceId: note.sourceSupplierInvoiceId, deletedAt: null },
      });
      if (validLines !== lineIds.length) throw new Error('LINE_NOT_IN_INVOICE');
      if (note.adjustmentTotal.lte(0)) throw new Error('ZERO_TOTAL');

      const result = await tx.supplierCreditDebitNote.update({
        where: { id },
        data: { status: 'SUBMITTED', version: { increment: 1 }, updatedById: user?.id ?? null },
      });

      await writeAuditLog({
        actorId: user?.id,
        action: 'supplier-credit-debit-note.submit',
        entityType: 'supplierCreditDebitNote',
        entityId: id,
        afterData: { status: 'SUBMITTED' },
        ...meta,
      });
      return result;
    });
    return ok(submitted);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, '供应商贷/借项通知单不存在');
    if (msg === 'INVALID_STATE') return failConflict(ERROR_CODES.CONFLICT, '仅 DRAFT 状态可提交');
    if (msg === 'VERSION_CONFLICT') return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试');
    if (msg === 'SOURCE_NOT_POSTED') return failConflict(ERROR_CODES.CONFLICT, '来源发票已非 POSTED，禁止提交');
    if (msg === 'LINE_NOT_IN_INVOICE') return failValidation({ lines: '存在不属于该发票的明细行' });
    if (msg === 'ZERO_TOTAL') return failValidation({ adjustmentTotal: '调整总额必须大于 0' });
    console.error('[supplier-credit-debit-note.submit]', err);
    return failConflict(ERROR_CODES.INTERNAL_ERROR, '提交失败（事务已回滚）');
  }
}