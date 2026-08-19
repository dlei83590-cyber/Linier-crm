import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, failValidation, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { z } from 'zod';
import { computeCnDnLineAmount, aggregateCnDnTotal } from '@/lib/supplier-cn-dn/helpers';

export const dynamic = 'force-dynamic';

const cnDnUpdateSchema = z
  .object({
    reason: z.string().min(1).max(500).optional(),
    lines: z
      .array(
        z.object({
          sourceSupplierInvoiceLineId: z.string().min(1),
          itemId: z.string().nullable().optional(),
          quantity: z.number().positive(),
        }),
      )
      .min(1)
      .optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: '至少提供一个更新字段' });

/** GET /api/supplier-credit-debit-notes/:id（详情含 lines + 审批/应用摘要） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'supplier-credit-debit-note:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'supplier-credit-debit-note.get');

  const { id } = await params;
  const note = await prisma.supplierCreditDebitNote.findFirst({
    where: { id, deletedAt: null },
    include: {
      supplier: { select: { id: true, code: true, name: true } },
      sourceSupplierInvoice: { select: { id: true, invoiceNo: true, supplierInvoiceNo: true, documentStatus: true } },
      lines: { orderBy: { lineNo: 'asc' }, include: { item: { select: { id: true, code: true, name: true } } } },
    },
  });
  if (!note) return failNotFound(ERROR_CODES.NOT_FOUND, '供应商贷/借项通知单不存在');
  return ok(note);
}

/** PATCH /api/supplier-credit-debit-notes/:id（DRAFT only + version CAS；行整体替换；金额服务端重算） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'supplier-credit-debit-note:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'supplier-credit-debit-note.update');

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = cnDnUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.supplierCreditDebitNote.findFirst({ where: { id, deletedAt: null }, include: { lines: true } });
      if (!existing) throw new Error('NOT_FOUND');
      if (existing.status !== 'DRAFT') throw new Error('INVALID_STATE');
      if (existing.version !== parsed.data.version) throw new Error('VERSION_CONFLICT');

      let linesData: Array<{ sourceSupplierInvoiceLineId: string; itemId: string | null; description: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; taxRate: Prisma.Decimal; amount: Prisma.Decimal; lineNo: number }> | undefined;
      if (parsed.data.lines) {
        const lineIds = parsed.data.lines.map((l) => l.sourceSupplierInvoiceLineId);
        const sourceLines = await tx.supplierInvoiceLine.findMany({
          where: { id: { in: lineIds }, supplierInvoiceId: existing.sourceSupplierInvoiceId, deletedAt: null },
          select: { id: true, itemId: true, unitPrice: true },
        });
        if (sourceLines.length !== lineIds.length) throw new Error('LINE_NOT_IN_INVOICE');
        const map = new Map(sourceLines.map((sl) => [sl.id, sl]));
        linesData = parsed.data.lines.map((l, i) => {
          const sl = map.get(l.sourceSupplierInvoiceLineId)!;
          return {
            sourceSupplierInvoiceLineId: l.sourceSupplierInvoiceLineId,
            itemId: l.itemId ?? sl.itemId ?? null,
            description: '供应商调整（' + (existing.noteType === 'CREDIT' ? '贷项' : '借项') + '）',
            quantity: new Prisma.Decimal(l.quantity),
            unitPrice: new Prisma.Decimal(sl.unitPrice.toString()),
            taxRate: new Prisma.Decimal(0),
            amount: computeCnDnLineAmount({
              quantity: new Prisma.Decimal(l.quantity),
              unitPrice: new Prisma.Decimal(sl.unitPrice.toString()),
            }),
            lineNo: (i + 1) * 10,
          };
        });
      }

      const result = await tx.supplierCreditDebitNote.update({
        where: { id },
        data: {
          ...(parsed.data.reason !== undefined ? { reason: parsed.data.reason } : {}),
          ...(linesData ? { lines: { deleteMany: {}, create: linesData } } : {}),
          ...(linesData ? { adjustmentTotal: aggregateCnDnTotal(linesData) } : {}),
          version: { increment: 1 },
          updatedById: user?.id ?? null,
        },
        include: { lines: true },
      });

      await writeAuditLog({
        actorId: user?.id,
        action: 'supplier-credit-debit-note.update',
        entityType: 'supplierCreditDebitNote',
        entityId: id,
        beforeData: { version: existing.version },
        afterData: { version: result.version, adjustmentTotal: result.adjustmentTotal.toString() },
        ...meta,
      });
      return result;
    });
    return ok(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, '供应商贷/借项通知单不存在');
    if (msg === 'INVALID_STATE') return failConflict(ERROR_CODES.CONFLICT, '仅 DRAFT 状态可编辑');
    if (msg === 'VERSION_CONFLICT') return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试');
    if (msg === 'LINE_NOT_IN_INVOICE') return failValidation({ lines: '存在不属于该发票的明细行' });
    console.error('[supplier-credit-debit-note.update]', err);
    return failConflict(ERROR_CODES.INTERNAL_ERROR, '更新失败（事务已回滚）');
  }
}