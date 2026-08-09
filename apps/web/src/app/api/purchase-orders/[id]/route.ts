import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { purchaseOrderUpdateSchema } from '@/lib/api/schemas';
import {
  computePurchaseOrderLineAmounts,
  recalcPurchaseOrderTotals,
  resolveSupplierPriceSnapshot,
  createPurchaseOrderRevision,
} from '@/lib/purchase-order/helpers';
import { publishPurchaseOrderEvent } from '@/lib/purchase-order/events';

export const dynamic = 'force-dynamic';

const EDITABLE_STATUSES = ['DRAFT'] as const;

/** GET /api/purchase-orders/:id（详情：Header + Supplier + Requisition + Workflow + Lines(Item/UOM/PriceSource) + Latest Revision + Snapshots） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'purchase-order:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-order.get');

  const { id } = await params;
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, deletedAt: null },
    include: {
      supplier: { select: { id: true, code: true, name: true, currency: true } },
      requisition: { select: { id: true, code: true, status: true } },
      workflowInstance: {
        select: { id: true, status: true, currentStepNo: true, startedAt: true, completedAt: true },
      },
      lines: {
        where: { deletedAt: null },
        orderBy: { lineNo: 'asc' },
        include: {
          item: { select: { id: true, code: true, name: true, model: true } },
          uom: { select: { id: true, code: true, name: true, symbol: true } },
          sourcePurchaseRequisitionLine: { select: { id: true, lineNo: true, itemId: true } },
        },
      },
      revisions: { where: { deletedAt: null }, orderBy: { revisionNo: 'desc' }, take: 1 },
      snapshots: { where: { deletedAt: null }, orderBy: { generatedAt: 'desc' }, take: 5 },
    },
  });
  if (!po) return failNotFound(ERROR_CODES.PURCHASE_ORDER_NOT_FOUND, '采购订单不存在');

  return ok(po);
}

/**
 * PATCH /api/purchase-orders/:id（更新头 + 可选行全量替换；仅 DRAFT；原子 CAS 乐观锁）
 * 红线（CTO 拍板③/调整③）：金额事实 = 服务端 Decimal 聚合，禁客户端直传头金额；
 * 行价格双通道（SUPPLIER_PRICE_SNAPSHOT 服务端解析 / MANUAL + priceReason/actor/audit）；
 * receivedQty / remainingReceiveQty 禁止客户端传入（5B 唯一回写方）；
 * 修改必须产生 Revision（变更前快照）；supplierId/currency 不可改（承诺事实锁定）；
 * SUBMITTED 后编辑触发重审属 Phase 4B（本阶段仅 DRAFT 可编辑）。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'purchase-order:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-order.update');

  const { id } = await params;
  const parsed = purchaseOrderUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version, changeReason, lines, ...fields } = parsed.data;
  const meta = requestMeta(request);

  const existing = await prisma.purchaseOrder.findFirst({
    where: { id, deletedAt: null },
    include: {
      supplier: { select: { id: true, partnerId: true, code: true } },
      lines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } },
    },
  });
  if (!existing) return failNotFound(ERROR_CODES.PURCHASE_ORDER_NOT_FOUND, '采购订单不存在');
  if ((EDITABLE_STATUSES as readonly string[]).includes(existing.status) === false) {
    return failConflict(
      ERROR_CODES.PURCHASE_ORDER_INVALID_STATE,
      `仅 DRAFT 状态可编辑（当前 ${existing.status}）`,
    );
  }
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试');
  }

  // 行替换时服务端验证 Item/UOM 引用 + REQUISITION 溯源（CTO Phase 4A Review Blocking ③）+ 价格双通道预解析
  let resolvedPrices: Array<{
    lineNo: number;
    unitPrice: Prisma.Decimal;
    taxRate: Prisma.Decimal;
    sourcePartnerPriceId: string | null;
    priceReason: string | null;
    priceSetById: string | null;
    priceSetAt: Date | null;
  }> | null = null;
  if (lines) {
    const itemIds = [...new Set(lines.map((l) => l.itemId))];
    const uomIds = [...new Set(lines.filter((l) => l.uomId).map((l) => l.uomId!))];
    const [items, uoms] = await Promise.all([
      prisma.item.findMany({
        where: { id: { in: itemIds }, deletedAt: null },
        select: { id: true },
      }),
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

    // **CTO Phase 4A Review Blocking ③**：溯源不得靠 lineNo 猜测——
    // REQUISITION 行必须显式提供 sourcePurchaseRequisitionLineId，服务端验证属于 Header.requisitionId + 未 deleted + itemId 一致；
    // Direct 行强制 source 为空。
    if (existing.sourceType === 'REQUISITION') {
      const missingSource = lines.filter((l) => !l.sourcePurchaseRequisitionLineId);
      if (missingSource.length > 0) {
        return fail(
          ERROR_CODES.PURCHASE_ORDER_SOURCE_LINE_REQUIRED,
          'REQUISITION 采购订单每行必须提供 sourcePurchaseRequisitionLineId',
          400,
        );
      }
      const sourceIds = [...new Set(lines.map((l) => l.sourcePurchaseRequisitionLineId!))];
      const sourceLines = await prisma.purchaseRequisitionLine.findMany({
        where: { id: { in: sourceIds }, deletedAt: null },
        select: { id: true, purchaseRequisitionId: true, itemId: true, uomId: true },
      });
      const sourceById = new Map(sourceLines.map((s) => [s.id, s]));
      for (const line of lines) {
        const src = sourceById.get(line.sourcePurchaseRequisitionLineId!);
        if (!src || src.purchaseRequisitionId !== existing.requisitionId) {
          return fail(
            ERROR_CODES.PURCHASE_ORDER_SOURCE_LINE_INVALID,
            'sourcePurchaseRequisitionLineId 不属于该采购申请（PR）',
            409,
          );
        }
        if (src.itemId !== line.itemId) {
          return fail(
            ERROR_CODES.PURCHASE_ORDER_SOURCE_LINE_INVALID,
            'PO 行 itemId 与来源 PR Line 不一致，禁止替换 Item 溯源',
            409,
          );
        }
      }
    } else if (lines.some((l) => l.sourcePurchaseRequisitionLineId)) {
      return fail(
        ERROR_CODES.PURCHASE_ORDER_SOURCE_LINE_FORBIDDEN,
        'Direct 采购订单不允许提供 sourcePurchaseRequisitionLineId',
        400,
      );
    }

    resolvedPrices = [];
    for (const [idx, line] of lines.entries()) {
      if (line.priceSource === 'SUPPLIER_PRICE_SNAPSHOT') {
        const snap = await resolveSupplierPriceSnapshot(prisma, {
          partnerId: existing.supplier.partnerId,
          itemId: line.itemId,
        });
        if (!snap) {
          return fail(
            ERROR_CODES.PURCHASE_ORDER_PRICE_NOT_FOUND,
            '未找到该物料的供应商价格快照（SUPPLIER_PRICE_SNAPSHOT），请改用 MANUAL 通道录入价格',
            409,
          );
        }
        resolvedPrices.push({
          lineNo: line.lineNo ?? (idx + 1) * 10,
          unitPrice: snap.unitPrice,
          taxRate: snap.taxRate,
          sourcePartnerPriceId: snap.partnerPriceId,
          priceReason: null,
          priceSetById: null,
          priceSetAt: null,
        });
      } else {
        resolvedPrices.push({
          lineNo: line.lineNo ?? (idx + 1) * 10,
          unitPrice: new Prisma.Decimal(line.unitPrice!),
          taxRate: new Prisma.Decimal(line.taxRate ?? 0),
          sourcePartnerPriceId: null,
          priceReason: line.priceReason ?? null,
          priceSetById: user!.id,
          priceSetAt: new Date(),
        });
      }
    }
  }

  let updated: Awaited<ReturnType<typeof prisma.purchaseOrder.findFirstOrThrow>>;
  try {
    // 单事务：Revision（变更前快照）+ 原子 CAS 头更新 + 行全量替换 + 金额重算
    // **CTO Phase 3 Review Blocking ① 教训沿用**：乐观锁必须数据库级原子——updateMany where {id, version, status:"DRAFT"} + count===1
    updated = await prisma.$transaction(async (tx) => {
      // 变更前快照 → Revision（修改必须产生 Revision；红线）
      const snapshot = {
        header: {
          code: existing.code,
          sourceType: existing.sourceType,
          supplierId: existing.supplierId,
          requisitionId: existing.requisitionId,
          status: existing.status,
          currency: existing.currency,
          paymentTerm: existing.paymentTerm,
          expectedDeliveryDate: existing.expectedDeliveryDate,
          remark: existing.remark,
        },
        lines: existing.lines.map((l) => ({
          lineNo: l.lineNo,
          itemId: l.itemId,
          description: l.description,
          quantity: l.quantity.toString(),
          uomId: l.uomId,
          priceSource: l.priceSource,
          unitPrice: l.unitPrice.toString(),
          taxRate: l.taxRate.toString(),
          lineAmount: l.lineAmount.toString(),
          taxAmount: l.taxAmount.toString(),
          totalAmount: l.totalAmount.toString(),
        })),
      };
      await createPurchaseOrderRevision(tx, id, changeReason ?? '更新采购订单', snapshot, user?.id);

      // 原子 CAS 头更新（仅非金额字段：purchaserId/departmentId/paymentTerm/expectedDeliveryDate/remark；金额由行聚合重算）
      const cas = await tx.purchaseOrder.updateMany({
        where: { id, version, status: 'DRAFT' },
        data: {
          ...(fields.purchaserId !== undefined ? { purchaserId: fields.purchaserId } : {}),
          ...(fields.departmentId !== undefined ? { departmentId: fields.departmentId } : {}),
          ...(fields.paymentTerm !== undefined ? { paymentTerm: fields.paymentTerm } : {}),
          ...(fields.expectedDeliveryDate !== undefined
            ? {
                expectedDeliveryDate: fields.expectedDeliveryDate
                  ? new Date(fields.expectedDeliveryDate)
                  : null,
              }
            : {}),
          ...(fields.remark !== undefined ? { remark: fields.remark } : {}),
          version: { increment: 1 },
          updatedById: user!.id,
        },
      });
      if (cas.count !== 1) throw new Error('PO_VERSION_CONFLICT');

      // 行全量替换（软删旧行 + 重建；价格双通道 + 金额服务端计算；receivedQty/remainingReceiveQty 初始化）
      if (lines && resolvedPrices) {
        await tx.purchaseOrderLine.updateMany({
          where: { purchaseOrderId: id, deletedAt: null },
          data: { deletedAt: new Date(), updatedById: user!.id },
        });
        // **CTO Phase 4A Review Blocking ③**：溯源不再按 lineNo 猜测——
        // REQUISITION 行使用请求中显式提供且已服务端验证的 sourcePurchaseRequisitionLineId；Direct 恒为空。
        const createdLines: Array<{
          lineAmount: Prisma.Decimal;
          taxAmount: Prisma.Decimal;
          totalAmount: Prisma.Decimal;
        }> = [];
        for (const [idx, line] of lines.entries()) {
          const quantity = new Prisma.Decimal(line.quantity);
          if (quantity.lte(0)) throw new Error('PO_QUANTITY_INVALID');
          const price = resolvedPrices[idx];
          const amounts = computePurchaseOrderLineAmounts({
            unitPrice: price.unitPrice,
            taxRate: price.taxRate,
            quantity,
          });
          createdLines.push(amounts);
          const lineNo = line.lineNo ?? (idx + 1) * 10;
          await tx.purchaseOrderLine.create({
            data: {
              purchaseOrderId: id,
              sourcePurchaseRequisitionLineId:
                existing.sourceType === 'REQUISITION' ? (line.sourcePurchaseRequisitionLineId ?? null) : null,
              lineNo,
              itemId: line.itemId,
              description: line.description ?? '',
              quantity,
              uomId: line.uomId ?? null,
              priceSource: line.priceSource,
              sourcePartnerPriceId: price.sourcePartnerPriceId,
              unitPrice: price.unitPrice,
              priceReason: price.priceReason,
              priceSetById: price.priceSetById,
              priceSetAt: price.priceSetAt,
              discountRate: new Prisma.Decimal(0),
              taxRate: price.taxRate,
              lineAmount: amounts.lineAmount,
              taxAmount: amounts.taxAmount,
              totalAmount: amounts.totalAmount,
              receivedQty: new Prisma.Decimal(0),
              remainingReceiveQty: quantity,
              createdById: user!.id,
              updatedById: user!.id,
            },
          });
        }
        // 头金额服务端重算（禁客户端直传）
        await recalcPurchaseOrderTotals(tx, id, createdLines);
      }

      return tx.purchaseOrder.findFirstOrThrow({ where: { id } });
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'PO_VERSION_CONFLICT') {
      return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试（并发修改）');
    }
    if (e instanceof Error && e.message === 'PO_QUANTITY_INVALID') {
      return fail(ERROR_CODES.PURCHASE_ORDER_QUANTITY_INVALID, '采购数量必须大于 0', 400);
    }
    throw e;
  }

  await publishPurchaseOrderEvent({
    eventType: 'PurchaseOrderUpdated',
    actorId: user?.id,
    entityId: id,
    payload: {
      purchaseOrderId: id,
      purchaseOrderCode: updated.code,
      sourceType: updated.sourceType,
      supplierId: updated.supplierId,
      requisitionId: updated.requisitionId,
      currency: updated.currency,
      totalAmount: updated.totalAmount.toString(),
      changeReason: changeReason ?? '更新采购订单',
      updatedBy: user?.id,
    },
    meta,
  }).catch(() => undefined);
  await writeAuditLog({
    actorId: user?.id,
    action: 'purchase-order.update',
    entityType: 'purchase-order',
    entityId: id,
    afterData: {
      fields: Object.keys(fields),
      linesReplaced: !!lines,
      version: updated.version,
      totalAmount: updated.totalAmount.toString(),
    },
    ...meta,
  });

  return ok(updated);
}
