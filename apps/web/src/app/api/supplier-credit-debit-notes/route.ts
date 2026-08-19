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

const cnDnCreateSchema = z
  .object({
    noteType: z.enum(['CREDIT', 'DEBIT']),
    sourceSupplierInvoiceId: z.string().min(1).optional(), // 单票兼容（旧客户端）
    sourceSupplierInvoiceIds: z.array(z.string().min(1)).min(1).optional(), // 跨票 Consolidated（Migration 0032）
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
  })
  .refine((v) => Boolean(v.sourceSupplierInvoiceIds) || Boolean(v.sourceSupplierInvoiceId), {
    message: '必须提供来源发票（sourceSupplierInvoiceId 或 sourceSupplierInvoiceIds）',
    path: ['sourceSupplierInvoiceIds'],
  })
  .transform((v) => ({
    ...v,
    // 归一化为数组（旧单票字段兼容）
    sourceSupplierInvoiceIds: v.sourceSupplierInvoiceIds ?? (v.sourceSupplierInvoiceId ? [v.sourceSupplierInvoiceId] : []),
  }));

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
        invoices: { include: { supplierInvoice: { select: { id: true, invoiceNo: true, supplierInvoiceNo: true, documentStatus: true } } } },
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
      const invoiceIds = [...new Set(parsed.data.sourceSupplierInvoiceIds)];
      const sourceInvoices = await tx.supplierInvoice.findMany({
        where: { id: { in: invoiceIds }, deletedAt: null },
        select: { id: true, documentStatus: true, supplierId: true, currency: true },
      });
      if (sourceInvoices.length !== invoiceIds.length) throw new Error('SOURCE_INVOICE_NOT_FOUND');
      for (const inv of sourceInvoices) {
        if (inv.documentStatus !== 'POSTED') throw new Error('SOURCE_INVOICE_NOT_POSTED');
      }
      // 同供应商同币种硬规则（跨票）
      const first = sourceInvoices[0];
      for (const inv of sourceInvoices) {
        if (inv.supplierId !== first.supplierId || inv.currency !== first.currency) {
          throw new Error('INVOICE_MISMATCH');
        }
      }

      // 行来源校验：全部行必须属于任一关联发票
      const lineIds = parsed.data.lines.map((l) => l.sourceSupplierInvoiceLineId);
      const sourceLines = await tx.supplierInvoiceLine.findMany({
        where: { id: { in: lineIds }, supplierInvoiceId: { in: invoiceIds }, deletedAt: null },
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
          // 跨票：sourceSupplierInvoiceId 留空（历史单票兼容），关联集合写 invoices 关联表
          sourceSupplierInvoiceId: null,
          supplierId: first.supplierId,
          currency: first.currency,
          reason: parsed.data.reason,
          adjustmentTotal: aggregateCnDnTotal(linesData),
          createdById: user?.id ?? null,
          updatedById: user?.id ?? null,
          lines: { create: linesData },
          invoices: {
            create: invoiceIds.map((invid) => ({ supplierInvoiceId: invid })),
          },
        },
        include: { lines: true, invoices: true },
      });

      await writeAuditLog({
        actorId: user?.id,
        action: 'supplier-credit-debit-note.create',
        entityType: 'supplierCreditDebitNote',
        entityId: note.id,
        afterData: { code: note.code, noteType: note.noteType, adjustmentTotal: note.adjustmentTotal.toString(), invoiceIds },
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
    if (msg === 'LINE_NOT_IN_INVOICE') return failValidation({ lines: '存在不属于任一关联发票的明细行' });
    if (msg === 'INVOICE_MISMATCH') return failValidation({ sourceSupplierInvoiceIds: '跨票调整要求全部发票同供应商同币种' });
    console.error('[supplier-credit-debit-note.create]', err);
    return failConflict(ERROR_CODES.INTERNAL_ERROR, '创建失败（事务已回滚）');
  }
}