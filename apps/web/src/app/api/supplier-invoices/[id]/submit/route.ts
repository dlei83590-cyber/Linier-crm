import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES, type ErrorCode } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { supplierInvoiceSubmitSchema } from '@/lib/api/schemas';
import { verifyReceiptBasedSourceChain } from '@/lib/supplier-invoice/helpers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/supplier-invoices/:id/submit —— DRAFT → SUBMITTED（CTO 5C-1A #9083）
 * - **第三次 RECEIPT_BASED 三重 Gate（红线 1）**：状态迁移前重新验证每行 WHR header = POSTED +
 *   WHR Line ↔ PO Line ↔ Item ↔ Supplier 来源链一致 + 数量 ≤ 已入库
 *   （即使创建/编辑后来源事实异常变化，也不会把失效来源带入后续 Match 阶段——CTO 指令）
 * - 校验：仅 DRAFT；CAS version 乐观锁；至少一条有效行
 * - **SUBMITTED ≠ POSTED**：submit 只做状态迁移，**不创建 MatchRun / GRIR / ApLiabilityFact**（5C-1B/1C），
 *   不写 postedAt/postedById（POSTED evidence 属 5C-1C）
 * - 事件：SUBMITTED 仅 AuditLog（SupplierInvoiceCreated 注册位保持 ⏳——EVENTS v1.30 口径，不造新事件）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // submit 映射现有动作（submit→:edit，不新造权限体系——对齐 5A/5B/6B 拍板）
  const denied = requirePermission(user, 'supplier-invoice:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'supplier-invoice.submit');

  const { id } = await params;
  const parsed = supplierInvoiceSubmitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const result = await prisma.$transaction(async (tx) => {
    // ① Lock SupplierInvoice（FOR UPDATE）
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "SupplierInvoice" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: 'NOT_FOUND' as const };

    const invoice = await tx.supplierInvoice.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, documentStatus: true, version: true, supplierId: true },
    });
    if (!invoice) return { error: 'NOT_FOUND' as const };

    // ② 状态门禁：仅 DRAFT（幂等：已 SUBMITTED → 409 INVALID_STATE/ALREADY_SUBMITTED）
    if (invoice.documentStatus !== 'DRAFT') {
      return { error: 'INVALID_STATE' as const, status: invoice.documentStatus };
    }
    // ③ CAS version
    if (invoice.version !== version) {
      return { error: 'VERSION_CONFLICT' as const };
    }

    // ④ 行存在校验
    const lines = await tx.supplierInvoiceLine.findMany({
      where: { supplierInvoiceId: id, deletedAt: null },
      select: { id: true, purchaseOrderLineId: true, warehouseReceiptLineId: true, quantity: true },
    });
    if (lines.length === 0) {
      return { error: 'NO_LINES' as const };
    }

    // ⑤ 第三次 RECEIPT_BASED 三重 Gate（红线 1）：状态迁移前重验 WHR POSTED + 来源链一致 + 数量 ≤ 已入库
    //    （Blocking ① CTO #9161：提交时自身行已在 DB（DRAFT 非 CANCELLED）——排除自身避免累计占用误报；
    //    helper 内部锁 WHR Line 防并发双计）
    const chain = await verifyReceiptBasedSourceChain(tx, {
      supplierId: invoice.supplierId,
      excludeInvoiceId: id,
      lines: lines.map((l) => ({
        purchaseOrderLineId: l.purchaseOrderLineId,
        warehouseReceiptLineId: l.warehouseReceiptLineId,
        quantity: l.quantity,
      })),
    });
    if (!chain.ok) {
      return { error: chain.error as 'WHR_NOT_POSTED' | 'SOURCE_CHAIN_MISMATCH' | 'ITEM_INVALID' | 'QUANTITY_INVALID' };
    }

    // ⑥ 状态迁移 DRAFT → SUBMITTED（**不创建 MatchRun/GRIR/ApLiabilityFact；不写 postedAt/postedById**）
    await tx.supplierInvoice.update({
      where: { id },
      data: {
        documentStatus: 'SUBMITTED',
        version: { increment: 1 },
        updatedById: actorId,
      },
    });

    const submitted = await tx.supplierInvoice.findFirst({
      where: { id, deletedAt: null },
      include: {
        supplier: { select: { id: true, code: true, name: true } },
        lines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } },
      },
    });
    return { error: null, invoice: submitted };
  });

  if (!result || result.error === 'NOT_FOUND') {
    return failNotFound(ERROR_CODES.SUPPLIER_INVOICE_NOT_FOUND, '供应商发票不存在');
  }
  if (result.error === 'INVALID_STATE') {
    const status = (result as { status?: string }).status;
    return failConflict(
      ERROR_CODES.SUPPLIER_INVOICE_INVALID_STATE,
      `仅 DRAFT 状态可提交（当前 ${status}）；已提交/已过账的发票不可重复提交`,
    );
  }
  if (result.error === 'VERSION_CONFLICT') {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试');
  }
  if (result.error === 'NO_LINES') {
    return fail(ERROR_CODES.SUPPLIER_INVOICE_NO_LINES, '发票至少需要一条有效行', 400);
  }
  if (result.error) {
    const codeMap: Record<string, { code: ErrorCode; msg: string }> = {
      WHR_NOT_POSTED: { code: ERROR_CODES.SUPPLIER_INVOICE_WHR_NOT_POSTED, msg: '入库行所属 WHR 必须已 POSTED（只有已入库事实可开票）' },
      SOURCE_CHAIN_MISMATCH: { code: ERROR_CODES.SUPPLIER_INVOICE_SOURCE_CHAIN_MISMATCH, msg: 'WHR Line ↔ PO Line ↔ Item ↔ Supplier 来源链不一致' },
      ITEM_INVALID: { code: ERROR_CODES.SUPPLIER_INVOICE_ITEM_INVALID, msg: '物料不存在/已停用或 PO/WHR 未绑定物料（NULL 穿透禁止）' },
      QUANTITY_INVALID: { code: ERROR_CODES.SUPPLIER_INVOICE_QUANTITY_INVALID, msg: '开票数量必须 > 0 且 ≤ 已入库数量' },
      CUMULATIVE_QTY_EXCEEDED: { code: ERROR_CODES.SUPPLIER_INVOICE_CUMULATIVE_QTY_EXCEEDED, msg: '累计开票数量超过已入库数量（含其他发票占用）' },
    };
    const entry = codeMap[result.error as 'WHR_NOT_POSTED' | 'SOURCE_CHAIN_MISMATCH' | 'ITEM_INVALID' | 'QUANTITY_INVALID' | 'CUMULATIVE_QTY_EXCEEDED'];
    if (entry) return fail(entry.code, entry.msg, 400);
    return fail(ERROR_CODES.INTERNAL_ERROR, '提交供应商发票失败', 500);
  }

  const invoice = result.invoice!;
  await writeAuditLog({
    actorId,
    action: 'supplier-invoice:submit',
    entityType: 'supplier-invoice',
    entityId: invoice.id,
    beforeData: { documentStatus: 'DRAFT', version },
    afterData: {
      invoiceNo: invoice.invoiceNo,
      documentStatus: invoice.documentStatus,
      netAmount: invoice.netAmount.toString(),
      taxAmount: invoice.taxAmount.toString(),
      grossAmount: invoice.grossAmount.toString(),
    },
    meta,
  });

  return ok({ invoice });
}
