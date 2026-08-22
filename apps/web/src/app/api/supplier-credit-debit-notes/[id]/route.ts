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
    sourceSupplierInvoiceIds: z.array(z.string().min(1)).min(1).optional(), // 跨票：DRAFT 可替换关联发票集合
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
      invoices: { include: { supplierInvoice: { select: { id: true, invoiceNo: true, supplierInvoiceNo: true, documentStatus: true } } } },
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

      // 有效关联发票集合：新集合（跨票替换）或现有关联（查询关联表；防御退化单票）
      let invoiceIds: string[] | undefined;
      if (parsed.data.sourceSupplierInvoiceIds) {
        invoiceIds = [...new Set(parsed.data.sourceSupplierInvoiceIds)];
        const invs = await tx.supplierInvoice.findMany({
          where: { id: { in: invoiceIds }, deletedAt: null },
          select: { id: true, documentStatus: true, supplierId: true, currency: true },
        });
        if (invs.length !== invoiceIds.length) throw new Error('SOURCE_INVOICE_NOT_FOUND');
        for (const inv of invs) {
          if (inv.documentStatus !== 'POSTED') throw new Error('SOURCE_INVOICE_NOT_POSTED');
        }
        const first = invs[0];
        for (const inv of invs) {
          if (inv.supplierId !== first.supplierId || inv.currency !== first.currency) throw new Error('INVOICE_MISMATCH');
        }
      } else {
        const links = await tx.supplierCreditDebitNoteInvoice.findMany({
          where: { creditDebitNoteId: id },
          select: { supplierInvoiceId: true },
        });
        invoiceIds = links.length > 0 ? links.map((l) => l.supplierInvoiceId) : existing.sourceSupplierInvoiceId ? [existing.sourceSupplierInvoiceId] : undefined;
      }

      let linesData: Array<{ sourceSupplierInvoiceLineId: string; itemId: string | null; description: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; taxRate: Prisma.Decimal; amount: Prisma.Decimal; lineNo: number }> | undefined;
      if (parsed.data.lines) {
        if (!invoiceIds || invoiceIds.length === 0) throw new Error('NO_INVOICES');
        const lineIds = parsed.data.lines.map((l) => l.sourceSupplierInvoiceLineId);
        const sourceLines = await tx.supplierInvoiceLine.findMany({
          where: { id: { in: lineIds }, supplierInvoiceId: { in: invoiceIds }, deletedAt: null },
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
          ...(parsed.data.sourceSupplierInvoiceIds && invoiceIds
            ? {
                invoices: { deleteMany: {}, create: invoiceIds.map((invid) => ({ supplierInvoiceId: invid })) },
                sourceSupplierInvoiceId: null,
              }
            : {}),
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
    if (msg === 'LINE_NOT_IN_INVOICE') return failValidation({ lines: '存在不属于任一关联发票的明细行' });
    if (msg === 'SOURCE_INVOICE_NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, '来源供应商发票不存在');
    if (msg === 'SOURCE_INVOICE_NOT_POSTED') return failConflict(ERROR_CODES.CONFLICT, '仅 POSTED 供应商发票可关联');
    if (msg === 'INVOICE_MISMATCH') return failValidation({ sourceSupplierInvoiceIds: '跨票调整要求全部发票同供应商同币种' });
    if (msg === 'NO_INVOICES') return failValidation({ sourceSupplierInvoiceIds: '请先提供关联发票集合' });
    console.error('[supplier-credit-debit-note.update]', err);
    return failConflict(ERROR_CODES.INTERNAL_ERROR, '更新失败（事务已回滚）');
  }
}
/** DELETE /api/supplier-credit-debit-notes/:id（层层回退-层层可删除，用户指令 2026-08-21）
 * 可删状态：DRAFT/SUBMITTED/CANCELLED（未 APPLIED）；APPLIED 禁止（已调整 AP Open Item）。
 * 软删 header + lines + 跨票关联。
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "supplier-credit-debit-note:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "supplier-cn-dn.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.supplierCreditDebitNote.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "供应商贷/借项通知单不存在");
  if (!["DRAFT", "SUBMITTED", "CANCELLED"].includes(existing.status)) {
    return failConflict(ERROR_CODES.NOT_FOUND, "仅 DRAFT/SUBMITTED/CANCELLED 状态可删除（已 APPLIED 禁止删除）");
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // 主表软删；lines/invoices 关联表无软删字段（保留溯源，onDelete Cascade 仅在主表硬删时级联）
    await tx.supplierCreditDebitNote.update({ where: { id }, data: { deletedAt: now, isActive: false, updatedById: user!.id } });
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "supplier-cn-dn.delete",
    entityType: "supplier-credit-debit-note",
    entityId: id,
    afterData: { code: existing.code },
    ...meta,
  });

  return ok({ id, deleted: true });
}
