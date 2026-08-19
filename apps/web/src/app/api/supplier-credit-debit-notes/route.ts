import { NextRequest } from 'next/server';
import type { SupplierCnDnType, SupplierCnDnStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, failValidation, failConflict, failNotFound, parsePagination } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { z } from 'zod';
import { nextSupplierCnDnCode, computeCnDnLineAmount, aggregateCnDnTotal, SupplierCnDnSequenceMissingError } from '@/lib/supplier-cn-dn/helpers';

export const dynamic = 'force-dynamic';

const cnDnCreateSchema = z.object({
  noteType: z.enum(['CREDIT', 'DEBIT']),
  sourceSupplierInvoiceId: z.string().min(1),
  reason: z.string().min(1).max(500),
  lines: z
    .array(
      z.object({
        sourceSupplierInvoiceLineId: z.string().min(1),
        itemId: z.string().nullable().optional(),
        quantity: z.number().positive(),
      }),
    )
    .min(1),
});

/** GET /api/supplier-credit-debit-notes（分页 + noteType/supplierId/status/sourceSupplierInvoiceId 过滤，5C-2） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'supplier-credit-debit-note:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'supplier-credit-debit-note.list');

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const noteType = searchParams.get('noteType')?.trim();
  const supplierId = searchParams.get('supplierId')?.trim();
  const status = searchParams.get('status')?.trim();
  const sourceSupplierInvoiceId = searchParams.get('sourceSupplierInvoiceId')?.trim();

  const where = {
    deletedAt: null,
    ...(noteType ? { noteType: noteType as SupplierCnDnType } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(status ? { status: status as SupplierCnDnStatus } : {}),
    ...(sourceSupplierInvoiceId ? { sourceSupplierInvoiceId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.supplierCreditDebitNote.count({ where }),
    prisma.supplierCreditDebitNote.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        supplier: { select: { id: true, code: true, name: true } },
        sourceSupplierInvoice: { select: { id: true, invoiceNo: true, supplierInvoiceNo: true, documentStatus: true } },
        _count: { select: { lines: true } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/supplier-credit-debit-notes（创建：sourceInvoice 必须 POSTED；code 创建即取号；金额服务端计算） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'supplier-credit-debit-note:create');
  if (denied) return denied;
  requestLog(request, user?.id, 'supplier-credit-debit-note.create');

  const meta = requestMeta(request);
  const parsed = cnDnCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  try {
    const created = await prisma.$transaction(async (tx) => {
      const sourceInvoice = await tx.supplierInvoice.findFirst({
        where: { id: parsed.data.sourceSupplierInvoiceId, deletedAt: null },
        select: { id: true, documentStatus: true, supplierId: true, currency: true },
      });
      if (!sourceInvoice) throw new Error('SOURCE_INVOICE_NOT_FOUND');
      if (sourceInvoice.documentStatus !== 'POSTED') throw new Error('SOURCE_INVOICE_NOT_POSTED');

      // 行来源校验：全部行必须属于该发票
      const lineIds = parsed.data.lines.map((l) => l.sourceSupplierInvoiceLineId);
      const sourceLines = await tx.supplierInvoiceLine.findMany({
        where: { id: { in: lineIds }, supplierInvoiceId: sourceInvoice.id, deletedAt: null },
        select: { id: true, itemId: true, unitPrice: true, quantity: true },
      });
      if (sourceLines.length !== lineIds.length) throw new Error('LINE_NOT_IN_INVOICE');

      const sourceLineMap = new Map(sourceLines.map((sl) => [sl.id, sl]));
      const linesData = parsed.data.lines.map((l, i) => {
        const sl = sourceLineMap.get(l.sourceSupplierInvoiceLineId)!;
        const amount = computeCnDnLineAmount({
          quantity: new Prisma.Decimal(l.quantity),
          unitPrice: new Prisma.Decimal(sl.unitPrice.toString()),
        });
        return {
          sourceSupplierInvoiceLineId: l.sourceSupplierInvoiceLineId,
          itemId: l.itemId ?? sl.itemId ?? null,
          description: '供应商调整（' + (parsed.data.noteType === 'CREDIT' ? '贷项' : '借项') + '）',
          quantity: new Prisma.Decimal(l.quantity),
          unitPrice: new Prisma.Decimal(sl.unitPrice.toString()),
          taxRate: new Prisma.Decimal(0),
          amount,
          lineNo: (i + 1) * 10,
        };
      });

      const code = await nextSupplierCnDnCode(tx, parsed.data.noteType);
      const note = await tx.supplierCreditDebitNote.create({
        data: {
          code,
          noteType: parsed.data.noteType as SupplierCnDnType,
          sourceSupplierInvoiceId: sourceInvoice.id,
          supplierId: sourceInvoice.supplierId,
          currency: sourceInvoice.currency,
          reason: parsed.data.reason,
          adjustmentTotal: aggregateCnDnTotal(linesData),
          createdById: user?.id ?? null,
          updatedById: user?.id ?? null,
          lines: { create: linesData },
        },
        include: { lines: true },
      });

      await writeAuditLog({
        actorId: user?.id,
        action: 'supplier-credit-debit-note.create',
        entityType: 'supplierCreditDebitNote',
        entityId: note.id,
        afterData: { code: note.code, noteType: note.noteType, adjustmentTotal: note.adjustmentTotal.toString() },
        ...meta,
      });
      return note;
    });
    return ok(created, undefined, 201);
  } catch (err) {
    if (err instanceof SupplierCnDnSequenceMissingError) {
      return failConflict(ERROR_CODES.INTERNAL_ERROR, err.message);
    }
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'SOURCE_INVOICE_NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, '来源供应商发票不存在');
    if (msg === 'SOURCE_INVOICE_NOT_POSTED') return failConflict(ERROR_CODES.CONFLICT, '仅 POSTED 供应商发票可生成贷/借项');
    if (msg === 'LINE_NOT_IN_INVOICE') return failValidation({ lines: '存在不属于该发票的明细行' });
    console.error('[supplier-credit-debit-note.create]', err);
    return failConflict(ERROR_CODES.INTERNAL_ERROR, '创建失败（事务已回滚）');
  }
}