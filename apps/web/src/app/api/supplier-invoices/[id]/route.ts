import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES, type ErrorCode } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { supplierInvoiceUpdateSchema } from '@/lib/api/schemas';
import {
  computeSupplierInvoiceLineAmounts,
  aggregateSupplierInvoiceTotals,
  supplierInvoiceLineDedupeKey,
  verifyReceiptBasedSourceChain,
} from '@/lib/supplier-invoice/helpers';

export const dynamic = 'force-dynamic';

/** 带关系的发票详情类型（PATCH 返回 + 审计 lineCount 用；findFirst include 泛型） */
type SupplierInvoiceWithRelations = NonNullable<
  Awaited<
    ReturnType<
      typeof prisma.supplierInvoice.findFirst<{
        include: {
          supplier: { select: { id: true; code: true; name: true } };
          lines: { where: { deletedAt: null }; orderBy: { lineNo: 'asc' } };
        };
      }>
    >
  >
>;

/** GET /api/supplier-invoices/:id（详情：Header + Supplier + Lines(双溯源 PO/WHR Line + Item)） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'supplier-invoice:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'supplier-invoice.get');

  const { id } = await params;
  const invoice = await prisma.supplierInvoice.findFirst({
    where: { id, deletedAt: null },
    include: {
      supplier: { select: { id: true, code: true, name: true } },
      lines: {
        where: { deletedAt: null },
        orderBy: { lineNo: 'asc' },
        include: {
          purchaseOrderLine: { select: { id: true, lineNo: true, itemId: true, quantity: true, unitPrice: true } },
          warehouseReceiptLine: {
            select: {
              id: true,
              quantity: true,
              warehouseReceipt: { select: { id: true, code: true, status: true } },
            },
          },
          item: { select: { id: true, code: true, name: true, model: true } },
        },
      },
    },
  });
  if (!invoice) return failNotFound(ERROR_CODES.SUPPLIER_INVOICE_NOT_FOUND, '供应商发票不存在');

  return ok(invoice);
}

/**
 * PATCH /api/supplier-invoices/:id（更新头 + 行整体替换；**仅 DRAFT**；CAS `id + version + status=DRAFT`）
 * CTO 5C-1A（#9083）：
 * - 仅 DRAFT 可编辑（INVALID_STATE）；CAS version 乐观锁（VERSION_CONFLICT）；
 * - supplierId / supplierInvoiceNo / currency / exchangeRate **不可编辑**（创建时锁定——P2 FX 快照；
 *   schema 不收这些字段）；invoiceDate/receivedDate/paymentDueDate/remark/lines 可改；
 * - 行整体替换：**第二次 RECEIPT_BASED 三重 Gate（红线 1）**——重新验证 WHR POSTED +
 *   WHR Line ↔ PO Line ↔ Item ↔ Supplier 来源链一致 + 数量 ≤ 已入库（helpers.verifyReceiptBasedSourceChain）；
 * - **来源链验证 + CAS 更新 + 行替换同一事务**（验证结果不会因并发来源变化而过期）；
 * - **金额重新服务端 Decimal 计算**（不信任客户端；行净额/税额/不可抵扣税 + 头聚合）；
 * - 行去重（同一 PO Line + WHR Line 只允许一次）；
 * - **红线：DRAFT 变更不发领域事件（仅 AuditLog）；DRAFT 不产生 AP/GRIR/MatchRun**（5C-1B/1C）。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'supplier-invoice:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'supplier-invoice.update');

  const { id } = await params;
  const parsed = supplierInvoiceUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version, lines, ...fields } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  // 行去重（同一 PO Line + WHR Line 双溯源组合只允许一次——API 前置）
  if (lines && lines.length > 0) {
    const keys = lines.map((l) => supplierInvoiceLineDedupeKey(l));
    if (new Set(keys).size !== keys.length) {
      return fail(ERROR_CODES.SUPPLIER_INVOICE_DUPLICATE_LINE, '同一 PO Line + 入库行只能开一次票（重复行）', 400);
    }
  }

  let result:
    | { ok: true; invoice: SupplierInvoiceWithRelations }
    | { ok: false; error: 'NOT_FOUND' | 'INVALID_STATE' | 'VERSION_CONFLICT' | 'WHR_NOT_POSTED' | 'SOURCE_CHAIN_MISMATCH' | 'ITEM_INVALID' | 'QUANTITY_INVALID' }
    | undefined;

  try {
    result = await prisma.$transaction(async (tx) => {
      // ① Lock SupplierInvoice（FOR UPDATE——来源链验证 + CAS 更新同锁，防并发来源变化）
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "SupplierInvoice" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (locked.length === 0) return { ok: false as const, error: 'NOT_FOUND' as const };

      const existing = await tx.supplierInvoice.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, documentStatus: true, version: true, supplierId: true },
      });
      if (!existing) return { ok: false as const, error: 'NOT_FOUND' as const };
      if (existing.documentStatus !== 'DRAFT') {
        return { ok: false as const, error: 'INVALID_STATE' as const };
      }
      if (existing.version !== version) {
        return { ok: false as const, error: 'VERSION_CONFLICT' as const };
      }

      // ② 行整体替换 → 第二次 RECEIPT_BASED 三重 Gate（红线 1）+ 金额服务端重算
      let computedLines: Array<{
        purchaseOrderLineId: string;
        warehouseReceiptLineId: string;
        itemId: string | null;
        lineNo: number;
        quantity: Prisma.Decimal;
        unitPrice: Prisma.Decimal;
        netAmount: Prisma.Decimal;
        taxRate: Prisma.Decimal;
        taxAmount: Prisma.Decimal;
        vatRecoverable: boolean;
        nonRecoverableTaxAmount: Prisma.Decimal;
        remark: string | null;
      }> | null = null;
      let totals: { netAmount: Prisma.Decimal; taxAmount: Prisma.Decimal; grossAmount: Prisma.Decimal } | null = null;

      if (lines && lines.length > 0) {
        const chain = await verifyReceiptBasedSourceChain(tx, {
          supplierId: existing.supplierId,
          lines: lines.map((l) => ({
            purchaseOrderLineId: l.purchaseOrderLineId,
            warehouseReceiptLineId: l.warehouseReceiptLineId,
            quantity: new Prisma.Decimal(l.quantity),
          })),
        });
        if (!chain.ok) return { ok: false as const, error: chain.error };

        computedLines = lines.map((l, idx) => {
          const amt = computeSupplierInvoiceLineAmounts({
            quantity: new Prisma.Decimal(l.quantity),
            unitPrice: new Prisma.Decimal(l.unitPrice),
            taxRate: new Prisma.Decimal(l.taxRate),
            vatRecoverable: l.vatRecoverable,
          });
          return {
            purchaseOrderLineId: l.purchaseOrderLineId,
            warehouseReceiptLineId: l.warehouseReceiptLineId,
            itemId: chain.itemIds[`${l.purchaseOrderLineId}:${l.warehouseReceiptLineId}`] ?? null,
            lineNo: (idx + 1) * 10,
            quantity: new Prisma.Decimal(l.quantity),
            unitPrice: new Prisma.Decimal(l.unitPrice),
            netAmount: amt.netAmount,
            taxRate: new Prisma.Decimal(l.taxRate),
            taxAmount: amt.taxAmount,
            vatRecoverable: l.vatRecoverable,
            nonRecoverableTaxAmount: amt.nonRecoverableTaxAmount,
            remark: l.remark ?? null,
          };
        });
        totals = aggregateSupplierInvoiceTotals(computedLines);
      }

      // ③ CAS 更新头（id + version + status=DRAFT 同时命中）
      const headerData: Prisma.SupplierInvoiceUpdateInput = { updatedById: actorId };
      if (fields.invoiceDate) headerData.invoiceDate = new Date(fields.invoiceDate);
      if (fields.receivedDate) headerData.receivedDate = new Date(fields.receivedDate);
      if (fields.paymentDueDate !== undefined) {
        headerData.paymentDueDate = fields.paymentDueDate ? new Date(fields.paymentDueDate) : null;
      }
      if (fields.remark !== undefined) headerData.remark = fields.remark;
      if (totals) {
        headerData.netAmount = totals.netAmount;
        headerData.taxAmount = totals.taxAmount;
        headerData.grossAmount = totals.grossAmount;
      }
      const res = await tx.supplierInvoice.updateMany({
        where: { id, version, documentStatus: 'DRAFT', deletedAt: null },
        data: { ...headerData, version: { increment: 1 } },
      });
      if (res.count === 0) return { ok: false as const, error: 'VERSION_CONFLICT' as const };

      // ④ 行整体替换（仅 DRAFT；物理删除旧行——对齐 6B deleteMany 先例；
      //    SupplierInvoiceLine 有 @@unique([supplierInvoiceId, lineNo])，软删重建会撞唯一键）
      if (computedLines) {
        await tx.supplierInvoiceLine.deleteMany({ where: { supplierInvoiceId: id, deletedAt: null } });
        await tx.supplierInvoiceLine.createMany({
          data: computedLines.map((l) => ({
            supplierInvoiceId: id,
            purchaseOrderLineId: l.purchaseOrderLineId,
            warehouseReceiptLineId: l.warehouseReceiptLineId,
            itemId: l.itemId,
            lineNo: l.lineNo,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            netAmount: l.netAmount,
            taxRate: l.taxRate,
            taxAmount: l.taxAmount,
            vatRecoverable: l.vatRecoverable,
            nonRecoverableTaxAmount: l.nonRecoverableTaxAmount,
            remark: l.remark,
            createdById: actorId,
            updatedById: actorId,
          })),
        });
      }

      const invoice = await tx.supplierInvoice.findFirst({
        where: { id, deletedAt: null },
        include: {
          supplier: { select: { id: true, code: true, name: true } },
          lines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } },
        },
      });
      if (!invoice) return { ok: false as const, error: 'NOT_FOUND' as const };
      return { ok: true as const, invoice };
    });
  } catch (err) {
    console.error('[supplier-invoice.update]', err);
    return fail(ERROR_CODES.INTERNAL_ERROR, '更新供应商发票失败', 500);
  }

  if (!result || !result.ok) {
    if (result?.error === 'NOT_FOUND') {
      return failNotFound(ERROR_CODES.SUPPLIER_INVOICE_NOT_FOUND, '供应商发票不存在');
    }
    if (result?.error === 'INVALID_STATE') {
      return failConflict(ERROR_CODES.SUPPLIER_INVOICE_INVALID_STATE, '仅 DRAFT 状态可编辑；已提交的发票事实不可修改');
    }
    if (result?.error === 'VERSION_CONFLICT') {
      return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试');
    }
    const codeMap: Record<string, { code: ErrorCode; msg: string }> = {
      WHR_NOT_POSTED: { code: ERROR_CODES.SUPPLIER_INVOICE_WHR_NOT_POSTED, msg: '入库行所属 WHR 必须已 POSTED（只有已入库事实可开票）' },
      SOURCE_CHAIN_MISMATCH: { code: ERROR_CODES.SUPPLIER_INVOICE_SOURCE_CHAIN_MISMATCH, msg: 'WHR Line ↔ PO Line ↔ Item ↔ Supplier 来源链不一致' },
      ITEM_INVALID: { code: ERROR_CODES.SUPPLIER_INVOICE_ITEM_INVALID, msg: '物料不存在或已停用' },
      QUANTITY_INVALID: { code: ERROR_CODES.SUPPLIER_INVOICE_QUANTITY_INVALID, msg: '开票数量必须 > 0 且 ≤ 已入库数量' },
    };
    const entry = result?.ok === false ? codeMap[result.error] : undefined;
    if (entry) return fail(entry.code, entry.msg, 400);
    return fail(ERROR_CODES.INTERNAL_ERROR, '更新供应商发票失败', 500);
  }

  const invoice = result.invoice;
  await writeAuditLog({
    actorId,
    action: 'supplier-invoice:update',
    entityType: 'supplier-invoice',
    entityId: invoice.id,
    beforeData: { version },
    afterData: {
      invoiceNo: invoice.invoiceNo,
      documentStatus: invoice.documentStatus,
      netAmount: invoice.netAmount.toString(),
      taxAmount: invoice.taxAmount.toString(),
      grossAmount: invoice.grossAmount.toString(),
      lineCount: invoice.lines.length,
    },
    meta,
  });

  return ok({ invoice });
}
