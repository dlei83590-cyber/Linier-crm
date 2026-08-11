import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, parsePagination } from '@/lib/api/response';
import { ERROR_CODES, type ErrorCode } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { supplierInvoiceCreateSchema } from '@/lib/api/schemas';
import {
  nextSupplierInvoiceNo,
  SupplierInvoiceSequenceMissingError,
  computeSupplierInvoiceLineAmounts,
  aggregateSupplierInvoiceTotals,
  supplierInvoiceLineDedupeKey,
  verifyReceiptBasedSourceChain,
} from '@/lib/supplier-invoice/helpers';

export const dynamic = 'force-dynamic';

/** GET /api/supplier-invoices（分页 + invoiceNo/supplierId/documentStatus/dateFrom/dateTo 过滤 + createdAt desc） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'supplier-invoice:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'supplier-invoice.list');

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const invoiceNo = searchParams.get('invoiceNo')?.trim();
  const supplierId = searchParams.get('supplierId')?.trim();
  const documentStatus = searchParams.get('documentStatus')?.trim();
  const dateFrom = searchParams.get('dateFrom')?.trim();
  const dateTo = searchParams.get('dateTo')?.trim();

  const where = {
    deletedAt: null,
    ...(invoiceNo ? { invoiceNo: { contains: invoiceNo, mode: 'insensitive' as const } } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(documentStatus ? { documentStatus: documentStatus as never } : {}),
    ...(dateFrom || dateTo
      ? {
          invoiceDate: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo) } : {}),
          },
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.supplierInvoice.count({ where }),
    prisma.supplierInvoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        supplier: { select: { id: true, code: true, name: true } },
        _count: { select: { lines: true } },
      },
    }),
  ]);

  return ok({ total, page, pageSize, items });
}

/**
 * POST /api/supplier-invoices —— 创建供应商发票（DRAFT；**创建即取号 SINV——P1 Final**）
 * CTO 5C-1A（#9048 FINAL APPROVED + #9083 API 指令）：
 * - **RECEIPT_BASED 三重 Gate（红线 1，第一次验证）**：每行 WHR header 必须 POSTED +
 *   WHR Line ↔ PO Line ↔ Item ↔ Supplier 来源链一致（helpers.verifyReceiptBasedSourceChain）
 * - **金额全部服务端 Decimal 计算**（CTO 红线：不信任客户端头金额/行金额——schema 不收金额；
 *   行 netAmount=quantity×unitPrice；taxAmount=netAmount×taxRate/100；nonRecoverableTaxAmount；
 *   头 net/tax/gross 聚合）
 * - **重复供应商发票号**：API 预检 409 SUPPLIER_INVOICE_DUPLICATE_NUMBER + DB 组合
 *   UNIQUE @@unique([supplierId, supplierInvoiceNo]) 最终防线（catch P2002 → 同 409）
 * - 状态：documentStatus=DRAFT / settlementStatus=UNPAID（P3 两维）；**DRAFT 不产生 AP/GRIR/MatchRun**（5C-1B/1C）
 * - 事件：DRAFT 创建仅 AuditLog（SupplierInvoiceCreated 注册位保持 ⏳——EVENTS v1.30 口径，不造新事件）
 */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'supplier-invoice:create');
  if (denied) return denied;
  requestLog(request, user?.id, 'supplier-invoice.create');

  const parsed = supplierInvoiceCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const data = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  // ① 行去重（同一发票内同一 PO Line + WHR Line 双溯源组合只允许一次——API 前置）
  const keys = data.lines.map((l) => supplierInvoiceLineDedupeKey(l));
  if (new Set(keys).size !== keys.length) {
    return fail(ERROR_CODES.SUPPLIER_INVOICE_DUPLICATE_LINE, '同一 PO Line + 入库行只能开一次票（重复行）', 400);
  }

  let result:
    | {
        ok: true;
        invoice: NonNullable<Awaited<ReturnType<typeof prisma.supplierInvoice.findFirst>>>;
      }
    | { ok: false; error: string }
    | undefined;

  try {
    result = await prisma.$transaction(async (tx) => {
      // ② 供应商校验（存在 + isActive）
      const supplier = await tx.supplier.findFirst({ where: { id: data.supplierId, deletedAt: null } });
      if (!supplier) return { ok: false as const, error: 'SUPPLIER_INVALID' };

      // ③ 重复供应商发票号预检（API 稳定 409；DB 组合 UNIQUE 兜底）
      const dup = await tx.supplierInvoice.findFirst({
        where: { supplierId: data.supplierId, supplierInvoiceNo: data.supplierInvoiceNo, deletedAt: null },
        select: { id: true },
      });
      if (dup) return { ok: false as const, error: 'DUPLICATE_NUMBER' };

      // ④ RECEIPT_BASED 三重 Gate（红线 1，第一次验证）：WHR POSTED + 来源链一致 + 数量 ≤ 已入库
      //    （Blocking ① CTO #9161：helper 内部锁 WHR Line + 累计占用校验——Create 无自身旧行，不传 excludeInvoiceId）
      const chain = await verifyReceiptBasedSourceChain(tx, {
        supplierId: data.supplierId,
        lines: data.lines.map((l) => ({
          purchaseOrderLineId: l.purchaseOrderLineId,
          warehouseReceiptLineId: l.warehouseReceiptLineId,
          quantity: new Prisma.Decimal(l.quantity),
        })),
      });
      if (!chain.ok) return { ok: false as const, error: chain.error };

      // ⑤ 金额服务端 Decimal 计算（不信任客户端）
      const computed = data.lines.map((l) => ({
        ...computeSupplierInvoiceLineAmounts({
          quantity: new Prisma.Decimal(l.quantity),
          unitPrice: new Prisma.Decimal(l.unitPrice),
          taxRate: new Prisma.Decimal(l.taxRate),
          vatRecoverable: l.vatRecoverable,
        }),
      }));
      const totals = aggregateSupplierInvoiceTotals(computed);

      // ⑥ 创建即取号 SINV（P1 Final；Sequence 缺失 fail closed）
      const invoiceNo = await nextSupplierInvoiceNo(tx);

      // ⑦ 创建（DRAFT；不产生 AP/GRIR/MatchRun）
      const invoice = await tx.supplierInvoice.create({
        data: {
          invoiceNo,
          supplierInvoiceNo: data.supplierInvoiceNo,
          supplierId: data.supplierId,
          invoiceDate: new Date(data.invoiceDate),
          receivedDate: new Date(data.receivedDate),
          currency: data.currency,
          exchangeRate: new Prisma.Decimal(data.exchangeRate),
          paymentDueDate: data.paymentDueDate ? new Date(data.paymentDueDate) : null,
          remark: data.remark ?? null,
          netAmount: totals.netAmount,
          taxAmount: totals.taxAmount,
          grossAmount: totals.grossAmount,
          createdById: actorId,
          updatedById: actorId,
          lines: {
            create: data.lines.map((l, idx) => ({
              purchaseOrderLineId: l.purchaseOrderLineId,
              warehouseReceiptLineId: l.warehouseReceiptLineId,
              itemId: chain.itemIds[`${l.purchaseOrderLineId}:${l.warehouseReceiptLineId}`] ?? null,
              lineNo: (idx + 1) * 10,
              quantity: new Prisma.Decimal(l.quantity),
              unitPrice: new Prisma.Decimal(l.unitPrice),
              netAmount: computed[idx].netAmount,
              taxRate: new Prisma.Decimal(l.taxRate),
              taxAmount: computed[idx].taxAmount,
              vatRecoverable: l.vatRecoverable,
              nonRecoverableTaxAmount: computed[idx].nonRecoverableTaxAmount,
              remark: l.remark ?? null,
              createdById: actorId,
              updatedById: actorId,
            })),
          },
        },
        include: {
          supplier: { select: { id: true, code: true, name: true } },
          lines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } },
        },
      });
      return { ok: true as const, invoice };
    });
  } catch (err) {
    // SINV DocumentSequence 缺失 = 部署配置错误（fail closed，禁 fallback）
    if (err instanceof SupplierInvoiceSequenceMissingError) {
      return fail(ERROR_CODES.SUPPLIER_INVOICE_SEQUENCE_MISSING, err.message, 500);
    }
    // DB 组合 UNIQUE 最终防线（supplierId + supplierInvoiceNo 并发重复 → 409）
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return fail(ERROR_CODES.SUPPLIER_INVOICE_DUPLICATE_NUMBER, '供应商发票号重复（供应商维度唯一）', 409);
    }
    console.error('[supplier-invoice.create]', err);
    return fail(ERROR_CODES.INTERNAL_ERROR, '创建供应商发票失败', 500);
  }

  if (!result || result.ok === false) {
    const codeMap: Record<string, { code: ErrorCode; msg: string; status: number }> = {
      SUPPLIER_INVALID: { code: ERROR_CODES.SUPPLIER_INVOICE_SUPPLIER_INVALID, msg: '供应商不存在或已停用', status: 400 },
      DUPLICATE_NUMBER: { code: ERROR_CODES.SUPPLIER_INVOICE_DUPLICATE_NUMBER, msg: '供应商发票号重复（供应商维度唯一）', status: 409 },
      WHR_NOT_POSTED: { code: ERROR_CODES.SUPPLIER_INVOICE_WHR_NOT_POSTED, msg: '入库行所属 WHR 必须已 POSTED（只有已入库事实可开票）', status: 400 },
      SOURCE_CHAIN_MISMATCH: { code: ERROR_CODES.SUPPLIER_INVOICE_SOURCE_CHAIN_MISMATCH, msg: 'WHR Line ↔ PO Line ↔ Item ↔ Supplier 来源链不一致', status: 400 },
      ITEM_INVALID: { code: ERROR_CODES.SUPPLIER_INVOICE_ITEM_INVALID, msg: '物料不存在/已停用或 PO/WHR 未绑定物料（NULL 穿透禁止）', status: 400 },
      QUANTITY_INVALID: { code: ERROR_CODES.SUPPLIER_INVOICE_QUANTITY_INVALID, msg: '开票数量必须 > 0 且 ≤ 已入库数量', status: 400 },
      CUMULATIVE_QTY_EXCEEDED: { code: ERROR_CODES.SUPPLIER_INVOICE_CUMULATIVE_QTY_EXCEEDED, msg: '累计开票数量超过已入库数量（含其他发票占用）', status: 400 },
    };
    const entry = result?.ok === false ? codeMap[result.error] : undefined;
    if (entry) return fail(entry.code, entry.msg, entry.status);
    return fail(ERROR_CODES.INTERNAL_ERROR, '创建供应商发票失败', 500);
  }

  await writeAuditLog({
    actorId,
    action: 'supplier-invoice:create',
    entityType: 'supplier-invoice',
    entityId: result.invoice.id,
    afterData: {
      invoiceNo: result.invoice.invoiceNo,
      supplierInvoiceNo: result.invoice.supplierInvoiceNo,
      supplierId: result.invoice.supplierId,
      documentStatus: result.invoice.documentStatus,
      netAmount: result.invoice.netAmount.toString(),
      taxAmount: result.invoice.taxAmount.toString(),
      grossAmount: result.invoice.grossAmount.toString(),
    },
    meta,
  });

  return ok({ invoice: result.invoice }, undefined, 201);
}
