import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failConflict, failNotFound, failServer } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { purchaseOrderConvertSchema } from '@/lib/api/schemas';
import {
  nextPurchaseOrderCode,
  computePurchaseOrderLineAmounts,
  recalcPurchaseOrderTotals,
  resolveSupplierPriceSnapshot,
  createPurchaseOrderRevision,
  createPurchaseOrderSnapshot,
} from '@/lib/purchase-order/helpers';
import { publishPurchaseOrderEvent } from '@/lib/purchase-order/events';
import { publishPurchaseRequisitionEvent } from '@/lib/purchase-requisition/events';

export const dynamic = 'force-dynamic';

/**
 * POST /api/purchase-requisitions/:id/convert — PR → PO 转换（sourceType=REQUISITION，唯一 REQUISITION 入口）
 * CTO 拍板②/设计 §5.3：
 *  - 前置校验：PR status=APPROVED（只有审批通过的 PR 才能转单）；未转换（无已存在 PO / status 非 CONVERTED）
 *  - 并发安全（对齐 Quotation Convert）：SELECT ... FOR UPDATE 真实行锁 → 原子取号 → 唯一约束（requisitionId 可多 PO？——REQUISITION 行保留 sourcePurchaseRequisitionLineId；重复转换由 status 门禁拦截）
 *  - 事务：创建 PO（DRAFT，sourceType=REQUISITION，requisitionId）→ 快照复制 PR Line
 *    （保留 sourcePurchaseRequisitionLineId；价格双通道：SUPPLIER_PRICE_SNAPSHOT 优先服务端解析 / MANUAL 授权录入）
 *    → 头金额服务端 Decimal 聚合 → receivedQty=0 / remainingReceiveQty=quantity 初始化 → Revision + Snapshot(CREATED)
 *    → 回写 PR status=CONVERTED（投影，不改 PR 数量/金额事实）→ 事件 PurchaseOrderCreated + PurchaseRequisitionConverted
 *  - 红线：PO 不修改 PR 数量/金额事实；审批不创建 PO（Convert 是显式动作）；不调 Pricing Engine、不重算
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // convert 映射现有动作（对齐 quotation.convert 先例：convert→:approve）
  const denied = requirePermission(user, 'purchase-requisition:approve');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-requisition.convert');

  const { id } = await params;
  const parsed = purchaseOrderConvertSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const data = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const result = await prisma
    .$transaction(async (tx) => {
      // ① 真实数据库行锁：SELECT ... FOR UPDATE 锁定 PR，串行化同一 PR 的并发转换
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "PurchaseRequisition" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (locked.length === 0) return { error: 'NOT_FOUND' as const };

      // ② 读取 PR（行已锁定）并校验：APPROVED / 未转换
      const pr = await tx.purchaseRequisition.findFirst({
        where: { id, deletedAt: null },
        include: { lines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } } },
      });
      if (!pr) return { error: 'NOT_FOUND' as const };
      if (pr.status !== 'APPROVED') {
        return { error: 'NOT_APPROVED' as const };
      }
      if (pr.status === 'CONVERTED') {
        return { error: 'ALREADY_CONVERTED' as const };
      }
      const existingPos = await tx.purchaseOrder.count({
        where: { requisitionId: id, deletedAt: null },
      });
      if (existingPos > 0) {
        return { error: 'ALREADY_CONVERTED' as const };
      }
      if (pr.lines.length === 0) {
        return { error: 'NO_LINES' as const };
      }

      // ③ Supplier 校验（主数据复用，不新建）
      const supplier = await tx.supplier.findFirst({
        where: { id: data.supplierId, deletedAt: null },
        select: { id: true, code: true, name: true, partnerId: true, currency: true },
      });
      if (!supplier) {
        return { error: 'SUPPLIER_NOT_FOUND' as const };
      }

      // ④ 原子取号（DocumentSequence docType=PURCHASE_ORDER）
      const code = await nextPurchaseOrderCode(tx);

      // ⑤ 创建 PO（DRAFT，sourceType=REQUISITION，requisitionId 溯源）
      const po = await tx.purchaseOrder.create({
        data: {
          code,
          sourceType: 'REQUISITION',
          supplierId: supplier.id,
          requisitionId: pr.id,
          status: 'DRAFT',
          orderDate: new Date(),
          expectedDeliveryDate: data.expectedDeliveryDate
            ? new Date(data.expectedDeliveryDate)
            : null,
          currency: data.currency ?? supplier.currency ?? 'CNY',
          paymentTerm: data.paymentTerm ?? null,
          remark: data.remark ?? null,
          createdById: actorId,
          updatedById: actorId,
        },
      });

      // ⑥ 快照复制 PR Line → PO Line（保留 sourcePurchaseRequisitionLineId；价格双通道）
      const priceOverrides = data.lines ?? [];
      for (const [idx, line] of pr.lines.entries()) {
        const override = priceOverrides[idx];
        const priceSource = override?.priceSource ?? 'SUPPLIER_PRICE_SNAPSHOT';
        let unitPrice: Prisma.Decimal;
        let taxRate: Prisma.Decimal;
        let sourcePartnerPriceId: string | null = null;
        let priceReason: string | null = null;
        let priceSetById: string | null = null;
        let priceSetAt: Date | null = null;
        if (priceSource === 'SUPPLIER_PRICE_SNAPSHOT') {
          if (!line.itemId) throw new Error('PO_ITEM_MISSING');
          const snap = await resolveSupplierPriceSnapshot(tx, {
            partnerId: supplier.partnerId,
            itemId: line.itemId,
          });
          if (!snap) throw new Error('PO_PRICE_NOT_FOUND');
          unitPrice = snap.unitPrice;
          taxRate = snap.taxRate;
          sourcePartnerPriceId = snap.partnerPriceId;
        } else {
          unitPrice = new Prisma.Decimal(override!.unitPrice!);
          taxRate = new Prisma.Decimal(override!.taxRate ?? 0);
          priceReason = override!.priceReason ?? null;
          priceSetById = actorId;
          priceSetAt = new Date();
        }
        const amounts = computePurchaseOrderLineAmounts({
          unitPrice,
          taxRate,
          quantity: line.quantity,
        });
        await tx.purchaseOrderLine.create({
          data: {
            purchaseOrderId: po.id,
            sourcePurchaseRequisitionLineId: line.id, // REQUISITION 溯源（拍板②）
            lineNo: line.lineNo,
            itemId: line.itemId,
            description: line.description,
            quantity: line.quantity,
            uomId: line.uomId,
            priceSource,
            sourcePartnerPriceId,
            unitPrice,
            priceReason,
            priceSetById,
            priceSetAt,
            discountRate: new Prisma.Decimal(0),
            taxRate,
            lineAmount: amounts.lineAmount,
            taxAmount: amounts.taxAmount,
            totalAmount: amounts.totalAmount,
            // 5B GR 投影初始化（receivedQty=0 / remainingReceiveQty=quantity；5A 禁客户端改）
            receivedQty: new Prisma.Decimal(0),
            remainingReceiveQty: line.quantity,
            createdById: actorId,
            updatedById: actorId,
          },
        });
      }

      // ⑦ 头金额服务端聚合（禁客户端直传）
      const poLines = await tx.purchaseOrderLine.findMany({
        where: { purchaseOrderId: po.id, deletedAt: null },
      });
      await recalcPurchaseOrderTotals(tx, po.id, poLines);

      // ⑧ Revision + Snapshot(CREATED)（金额 Decimal toString 落 JSON）
      const poFull = await tx.purchaseOrder.findFirstOrThrow({ where: { id: po.id } });
      await createPurchaseOrderRevision(
        tx,
        po.id,
        'PR 转 PO（REQUISITION）',
        {
          header: {
            code,
            sourceType: 'REQUISITION',
            supplierId: supplier.id,
            requisitionId: pr.id,
            status: 'DRAFT',
            currency: poFull.currency,
            paymentTerm: poFull.paymentTerm,
            expectedDeliveryDate: poFull.expectedDeliveryDate,
            remark: poFull.remark,
          },
          lines: poLines.map((l) => ({
            lineNo: l.lineNo,
            itemId: l.itemId,
            description: l.description,
            quantity: l.quantity.toString(),
            priceSource: l.priceSource,
            unitPrice: l.unitPrice.toString(),
            taxRate: l.taxRate.toString(),
            lineAmount: l.lineAmount.toString(),
            taxAmount: l.taxAmount.toString(),
            totalAmount: l.totalAmount.toString(),
          })),
        },
        actorId,
      );
      await createPurchaseOrderSnapshot(
        tx,
        po.id,
        'CREATED',
        {
          status: 'DRAFT',
          sourceType: 'REQUISITION',
          supplierId: supplier.id,
          supplierCode: supplier.code,
          requisitionId: pr.id,
          requisitionCode: pr.code,
          currency: poFull.currency,
          subtotal: poFull.subtotal.toString(),
          taxAmount: poFull.taxAmount.toString(),
          totalAmount: poFull.totalAmount.toString(),
          convertedBy: actorId,
          convertedAt: new Date().toISOString(),
        },
        actorId,
      );

      // ⑨ 回写 PR status=CONVERTED（投影，不改 PR 数量/金额事实）
      await tx.purchaseRequisition.update({
        where: { id: pr.id },
        data: { status: 'CONVERTED', updatedById: actorId },
      });

      return { error: null as null, po, prCode: pr.code, supplier };
    })
    .catch((err: unknown) => {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { error: 'ALREADY_CONVERTED' as const };
      }
      if (err instanceof Error && err.message === 'PO_ITEM_MISSING') {
        return { error: 'ITEM_MISSING' as const };
      }
      if (err instanceof Error && err.message === 'PO_PRICE_NOT_FOUND') {
        return { error: 'PRICE_NOT_FOUND' as const };
      }
      throw err;
    });

  if (result.error === 'NOT_FOUND') {
    return failNotFound(ERROR_CODES.PURCHASE_REQUISITION_NOT_FOUND, '采购申请不存在');
  }
  if (result.error === 'NOT_APPROVED') {
    return failConflict(
      ERROR_CODES.PURCHASE_ORDER_REQUISITION_NOT_APPROVED,
      '仅 APPROVED 状态的采购申请可转采购订单',
    );
  }
  if (result.error === 'ALREADY_CONVERTED') {
    return failConflict(
      ERROR_CODES.PURCHASE_ORDER_REQUISITION_ALREADY_CONVERTED,
      '采购申请已转换，禁止重复转换',
    );
  }
  if (result.error === 'NO_LINES') {
    return failConflict(ERROR_CODES.PURCHASE_ORDER_NO_LINES, '采购申请至少需要一行明细');
  }
  if (result.error === 'SUPPLIER_NOT_FOUND') {
    return fail(ERROR_CODES.PURCHASE_ORDER_SUPPLIER_NOT_FOUND, '供应商不存在', 400);
  }
  if (result.error === 'PRICE_NOT_FOUND') {
    return fail(
      ERROR_CODES.PURCHASE_ORDER_PRICE_NOT_FOUND,
      '未找到该物料的供应商价格快照（SUPPLIER_PRICE_SNAPSHOT），请改用 MANUAL 通道录入价格',
      409,
    );
  }
  if (!result.error && !result.po) {
    return failServer('创建采购订单失败');
  }

  // ⑩ AuditLog + Domain Event：PurchaseOrderCreated + PurchaseRequisitionConverted（事务外，降级不阻断）
  await writeAuditLog({
    actorId,
    action: 'purchase-requisition.convert',
    entityType: 'purchase-requisition',
    entityId: id,
    afterData: { purchaseOrderId: result.po!.id, purchaseOrderCode: result.po!.code },
    ...meta,
  });
  await Promise.allSettled([
    publishPurchaseOrderEvent({
      eventType: 'PurchaseOrderCreated',
      actorId,
      entityId: result.po!.id,
      payload: {
        purchaseOrderId: result.po!.id,
        purchaseOrderCode: result.po!.code,
        sourceType: 'REQUISITION',
        supplierId: result.supplier.id,
        requisitionId: id,
        currency: result.po!.currency,
        totalAmount: result.po!.totalAmount.toString(),
        convertedBy: actorId,
        convertedAt: new Date().toISOString(),
      },
      meta,
    }),
    publishPurchaseRequisitionEvent({
      eventType: 'PurchaseRequisitionConverted',
      actorId,
      entityId: id,
      payload: {
        requisitionId: id,
        requisitionCode: result.prCode,
        purchaseOrderId: result.po!.id,
        purchaseOrderCode: result.po!.code,
        convertedBy: actorId,
        convertedAt: new Date().toISOString(),
      },
      meta,
    }),
  ]);

  return ok({ id: result.po!.id, code: result.po!.code, status: 'DRAFT', requisitionId: id });
}
