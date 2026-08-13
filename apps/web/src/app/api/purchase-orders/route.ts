import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, failServer, parsePagination } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { purchaseOrderCreateSchema } from '@/lib/api/schemas';
import {
  nextPurchaseOrderCode,
  computePurchaseOrderLineAmounts,
  recalcPurchaseOrderTotals,
  resolveSupplierPriceSnapshot,
  createPurchaseOrderRevision,
  createPurchaseOrderSnapshot,
} from '@/lib/purchase-order/helpers';
import { publishPurchaseOrderEvent } from '@/lib/purchase-order/events';
import { handleServerError } from "@/lib/api/server-error";

export const dynamic = 'force-dynamic';

/** GET /api/purchase-orders（分页 + code/supplierId/status/sourceType/dateFrom/dateTo 过滤 + createdAt desc 排序） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'purchase-order:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-order.list');

  try {

    const { searchParams } = new URL(request.url);
    const { page, pageSize, skip, take } = parsePagination(searchParams);
    const code = searchParams.get('code')?.trim();
    const supplierId = searchParams.get('supplierId')?.trim();
    const status = searchParams.get('status')?.trim();
    const sourceType = searchParams.get('sourceType')?.trim();
    const dateFrom = searchParams.get('dateFrom')?.trim();
    const dateTo = searchParams.get('dateTo')?.trim();

    const where = {
      deletedAt: null,
      ...(code ? { code: { contains: code, mode: 'insensitive' as const } } : {}),
      ...(supplierId ? { supplierId } : {}),
      ...(status ? { status: status as never } : {}),
      ...(sourceType ? { sourceType: sourceType as never } : {}),
      ...(dateFrom || dateTo
        ? {
            orderDate: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lte: new Date(dateTo) } : {}),
            },
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      prisma.purchaseOrder.count({ where }),
      prisma.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          supplier: { select: { id: true, code: true, name: true } },
          requisition: { select: { id: true, code: true } },
          _count: { select: { lines: true } },
        },
      }),
    ]);

    return ok(items, { page, pageSize, total });
  } catch (error) {
    return handleServerError(request, user?.id, "purchase-order.list", error);
  }

}

/**
 * POST /api/purchase-orders（Direct Purchase 创建，sourceType=DIRECT；Header + Lines 单事务）
 * CTO 拍板②（Direct 显式可审计）：requisitionId 为空、line sourcePurchaseRequisitionLineId 为空；
 * **Direct 不能绕过 PO Approval**——Submit/Approval/Confirm 属 Phase 4B；
 * 红线（CTO 拍板③）：价格双通道（SUPPLIER_PRICE_SNAPSHOT 优先服务端解析 / MANUAL 授权 + priceReason/actor/audit）；
 * 头金额 = 服务端 Decimal 聚合（subtotal/taxAmount/totalAmount），**禁客户端直传总额**；
 * PO 不调 Pricing Engine、不重算；税率快照复制（拍板④）；
 * Line 预留 receivedQty=0 / remainingReceiveQty=quantity（5A 禁客户端改，5B 唯一回写方）。
 */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'purchase-order:create');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-order.create');

  const parsed = purchaseOrderCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const data = parsed.data;
  const meta = requestMeta(request);

  // **CTO Phase 4A Re-review 细节①**：Direct 模式必须**强制禁止** sourcePurchaseRequisitionLineId，不是只忽略客户端传值——
  // 客户端传了就是非法请求，直接 400 拒绝（对齐 PATCH 的 SOURCE_LINE_FORBIDDEN 语义）
  if (data.lines.some((l) => l.sourcePurchaseRequisitionLineId)) {
    return fail(
      ERROR_CODES.PURCHASE_ORDER_SOURCE_LINE_FORBIDDEN,
      'Direct 采购订单不允许提供 sourcePurchaseRequisitionLineId',
      400,
    );
  }

  // 服务端验证 Supplier / Item / UOM 引用
  const supplier = await prisma.supplier.findFirst({
    where: { id: data.supplierId, deletedAt: null },
    select: { id: true, code: true, name: true, partnerId: true, currency: true },
  });
  if (!supplier) {
    return fail(ERROR_CODES.PURCHASE_ORDER_SUPPLIER_NOT_FOUND, '供应商不存在', 400);
  }
  const itemIds = [...new Set(data.lines.map((l) => l.itemId))];
  const uomIds = [...new Set(data.lines.filter((l) => l.uomId).map((l) => l.uomId!))];
  const [items, uoms] = await Promise.all([
    prisma.item.findMany({ where: { id: { in: itemIds }, deletedAt: null }, select: { id: true } }),
    uomIds.length > 0
      ? prisma.unitOfMeasure.findMany({
          where: { id: { in: uomIds }, deletedAt: null },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);
  if (items.length !== itemIds.length) {
    return fail(ERROR_CODES.PURCHASE_ORDER_ITEM_NOT_FOUND, '存在无效的 Item 引用', 400);
  }
  if (uoms.length !== uomIds.length) {
    return fail(ERROR_CODES.PURCHASE_ORDER_UOM_NOT_FOUND, '存在无效的 UOM 引用', 400);
  }

  const currency = data.currency ?? supplier.currency ?? 'CNY';
  const actorId = user!.id;

  // 事务：取号 + Header + Lines（价格双通道 + 金额服务端聚合 + receivedQty/remainingReceiveQty 初始化）
  let created: { id: string; code: string; totalAmount: Prisma.Decimal } | null = null;
  try {
    created = await prisma.$transaction(async (tx) => {
      const code = await nextPurchaseOrderCode(tx);
      const header = await tx.purchaseOrder.create({
        data: {
          code,
          sourceType: 'DIRECT',
          supplierId: supplier.id,
          purchaserId: data.purchaserId ?? null, // 采购员（CTO Phase 4B 指令：PO Header 落地）
          departmentId: data.departmentId ?? null, // 采购部门
          requisitionId: null,
          status: 'DRAFT',
          orderDate: new Date(),
          expectedDeliveryDate: data.expectedDeliveryDate
            ? new Date(data.expectedDeliveryDate)
            : null,
          currency,
          paymentTerm: data.paymentTerm ?? null,
          remark: data.remark ?? null,
          createdById: actorId,
          updatedById: actorId,
        },
        select: { id: true, code: true },
      });

      for (const [idx, line] of data.lines.entries()) {
        const quantity = new Prisma.Decimal(line.quantity);
        if (quantity.lte(0)) throw new Error('PO_QUANTITY_INVALID');

        // 价格双通道（CTO 拍板③）
        let unitPrice: Prisma.Decimal;
        let taxRate: Prisma.Decimal;
        let sourcePartnerPriceId: string | null = null;
        let priceReason: string | null = null;
        let priceSetById: string | null = null;
        let priceSetAt: Date | null = null;
        if (line.priceSource === 'SUPPLIER_PRICE_SNAPSHOT') {
          const snap = await resolveSupplierPriceSnapshot(tx, {
            partnerId: supplier.partnerId,
            itemId: line.itemId,
          });
          if (!snap) {
            throw new Error('PO_PRICE_NOT_FOUND');
          }
          unitPrice = snap.unitPrice;
          taxRate = snap.taxRate;
          sourcePartnerPriceId = snap.partnerPriceId;
        } else {
          // MANUAL：schema 已保证 unitPrice>0 + priceReason 非空
          unitPrice = new Prisma.Decimal(line.unitPrice!);
          taxRate = new Prisma.Decimal(line.taxRate ?? 0);
          priceReason = line.priceReason ?? null;
          priceSetById = actorId;
          priceSetAt = new Date();
        }

        const amounts = computePurchaseOrderLineAmounts({ unitPrice, taxRate, quantity });

        await tx.purchaseOrderLine.create({
          data: {
            purchaseOrderId: header.id,
            sourcePurchaseRequisitionLineId: null, // Direct：来源字段为空（拍板②）
            lineNo: line.lineNo ?? (idx + 1) * 10,
            itemId: line.itemId,
            description: line.description ?? '',
            quantity,
            uomId: line.uomId ?? null,
            priceSource: line.priceSource,
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
            // 5B GR 投影初始化（CTO 调整③：receivedQty=0 / remainingReceiveQty=quantity；5A 禁客户端改）
            receivedQty: new Prisma.Decimal(0),
            remainingReceiveQty: quantity,
            createdById: actorId,
            updatedById: actorId,
          },
        });
      }

      // **CTO Phase 4A Review Blocking ②**：Revision 必须从**实际落库的 PO Lines** 生成（不是请求 body 重组）——
      // SUPPLIER_PRICE_SNAPSHOT 的真实 unitPrice/taxRate/sourcePartnerPriceId 才进历史留痕
      const actualLines = await tx.purchaseOrderLine.findMany({
        where: { purchaseOrderId: header.id, deletedAt: null },
        orderBy: { lineNo: 'asc' },
      });

      // 头金额服务端聚合（禁客户端直传；用实际落库行重算，防 body 与事实偏差）
      await recalcPurchaseOrderTotals(tx, header.id, actualLines);

      // Revision(CREATED) + Snapshot(CREATED)（金额 Decimal toString 落 JSON）
      const headerFull = await tx.purchaseOrder.findFirstOrThrow({ where: { id: header.id } });
      await createPurchaseOrderRevision(
        tx,
        header.id,
        '创建采购订单',
        {
          header: {
            code,
            sourceType: 'DIRECT',
            supplierId: supplier.id,
            status: 'DRAFT',
            currency,
            paymentTerm: headerFull.paymentTerm,
            expectedDeliveryDate: headerFull.expectedDeliveryDate,
            remark: headerFull.remark,
          },
          lines: actualLines.map((l) => ({
            lineNo: l.lineNo,
            itemId: l.itemId,
            description: l.description,
            quantity: l.quantity.toString(),
            uomId: l.uomId,
            priceSource: l.priceSource,
            sourcePartnerPriceId: l.sourcePartnerPriceId,
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
        header.id,
        'CREATED',
        {
          status: 'DRAFT',
          sourceType: 'DIRECT',
          supplierId: supplier.id,
          supplierCode: supplier.code,
          currency,
          subtotal: headerFull.subtotal.toString(),
          taxAmount: headerFull.taxAmount.toString(),
          totalAmount: headerFull.totalAmount.toString(),
          createdBy: actorId,
          createdAt: new Date().toISOString(),
        },
        actorId,
      );

      return { id: header.id, code, totalAmount: headerFull.totalAmount };
    });
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === 'PO_QUANTITY_INVALID') {
        return fail(ERROR_CODES.PURCHASE_ORDER_QUANTITY_INVALID, '采购数量必须大于 0', 400);
      }
      if (e.message === 'PO_PRICE_NOT_FOUND') {
        return fail(
          ERROR_CODES.PURCHASE_ORDER_PRICE_NOT_FOUND,
          '未找到该物料的供应商价格快照（SUPPLIER_PRICE_SNAPSHOT），请改用 MANUAL 通道录入价格',
          409,
        );
      }
    }
    throw e;
  }

  if (!created) return failServer('创建采购订单失败');

  // **CTO Phase 4A Review Blocking ①**：Domain Event 必须携带真实金额，禁止 placeholder
  await publishPurchaseOrderEvent({
    eventType: 'PurchaseOrderCreated',
    actorId: user?.id,
    entityId: created.id,
    payload: {
      purchaseOrderId: created.id,
      purchaseOrderCode: created.code,
      sourceType: 'DIRECT',
      supplierId: supplier.id,
      requisitionId: null,
      currency,
      totalAmount: created.totalAmount.toString(),
      createdBy: user?.id,
    },
    meta,
  }).catch(() => undefined);
  await writeAuditLog({
    actorId: user?.id,
    action: 'purchase-order.create',
    entityType: 'purchase-order',
    entityId: created.id,
    afterData: {
      code: created.code,
      sourceType: 'DIRECT',
      lineCount: data.lines.length,
      supplierId: supplier.id,
    },
    ...meta,
  });

  return ok(created);
}
