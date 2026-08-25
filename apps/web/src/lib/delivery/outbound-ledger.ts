import { Prisma } from '@prisma/client';
import type { LedgerAtom } from '@/lib/inventory-ledger/ledger-command';

/**
 * 合同收口-销售出库：Delivery DISPATCH → 真正库存扣减（不能再用状态变化冒充出库）
 *
 * 本文件只负责把 Delivery/DeliveryLine 出库事实翻译成共享 LedgerCommand 的原子（LedgerAtom），
 * 库存算法/幂等/锁/投影全部复用 InventoryLedgerCommand Core（红线：禁止复制库存算法）。
 *
 * 五元幂等：sourceType=SALES_DELIVERY | sourceId=delivery.id | sourceLineId=deliveryLine.id |
 *           movementRole=OUT | movementAtomKey=BULK（非 serial；DeliveryLine 无 serial 维度）
 * movementGroupId = delivery.id（稳定业务事实：同一次 DISPATCH 的全部行归组，与 Adjustment 用单据 id 一致）
 *
 * 冲销（Delivery 删除恢复库存）：sourceType=REVERSAL，sourceId=`DELIVERY_DELETE:{delivery.id}`，
 * sourceLineId=原 Movement id（REVERSAL 拥有自己的 source/action identity，不与原 Movement 共用五元），
 * reversalOfMovementId=原 Movement id（DB @unique：一笔 Movement 最多被完整冲销一次）。
 */

export interface SalesDeliveryOutboundLine {
  id: string;
  itemId: string | null;
  quantity: Prisma.Decimal;
  uomId: string | null;
}

export interface SalesDeliveryOutboundContext {
  deliveryId: string;
  deliveryCode: string;
  warehouseId: string;
  locationId: string | null;
  actorId: string;
  occurredAt: string;
}

/** 构造 DISPATCH 出库原子（只对物料行 itemId != null 生成；非物料行无库存效应） */
export function buildSalesDeliveryOutboundAtoms(
  ctx: SalesDeliveryOutboundContext,
  lines: SalesDeliveryOutboundLine[],
): LedgerAtom[] {
  const atoms: LedgerAtom[] = [];
  for (const line of lines) {
    if (!line.itemId) continue; // 非物料行（如服务/描述行）不参与库存扣减
    atoms.push({
      sourceType: 'SALES_DELIVERY',
      sourceId: ctx.deliveryId,
      sourceLineId: line.id,
      movementRole: 'OUT',
      movementAtomKey: 'BULK',
      movementGroupId: ctx.deliveryId,
      direction: 'OUT',
      movementType: 'OUTBOUND',
      warehouseId: ctx.warehouseId,
      locationId: ctx.locationId,
      itemId: line.itemId,
      batchNo: null,
      serialNo: null,
      quantity: line.quantity,
      uomId: line.uomId,
      mfgDate: null,
      expDate: null,
      referenceNo: ctx.deliveryCode,
      actorId: ctx.actorId,
      occurredAt: ctx.occurredAt,
      remark: '销售出库（Delivery DISPATCH）',
    });
  }
  return atoms;
}

export interface SalesDeliveryOriginalMovement {
  id: string;
  warehouseId: string;
  locationId: string | null;
  itemId: string;
  batchNo: string | null;
  serialNo: string | null;
  quantity: Prisma.Decimal;
  uomId: string | null;
  movementAtomKey: string;
  mfgDate: Date | null;
  expDate: Date | null;
}

/** 构造删除 DISPATCHED Delivery 的 REVERSAL 原子（IN 恢复库存；禁止 delete movement / 无 movement 直接加回投影） */
export function buildSalesDeliveryReversalAtoms(
  ctx: { deliveryId: string; deliveryCode: string; actorId: string | null; occurredAt: string },
  originalMovements: SalesDeliveryOriginalMovement[],
): LedgerAtom[] {
  const actionSourceId = `DELIVERY_DELETE:${ctx.deliveryId}`;
  const atoms: LedgerAtom[] = [];
  for (const mv of originalMovements) {
    atoms.push({
      sourceType: 'REVERSAL',
      sourceId: actionSourceId,
      sourceLineId: mv.id,
      movementRole: 'REVERSAL',
      movementAtomKey: mv.movementAtomKey,
      movementGroupId: actionSourceId,
      reversalOfMovementId: mv.id,
      direction: 'IN',
      movementType: 'REVERSAL',
      warehouseId: mv.warehouseId,
      locationId: mv.locationId,
      itemId: mv.itemId,
      batchNo: mv.batchNo,
      serialNo: mv.serialNo,
      quantity: mv.quantity,
      uomId: mv.uomId,
      mfgDate: mv.mfgDate,
      expDate: mv.expDate,
      referenceNo: ctx.deliveryCode,
      actorId: ctx.actorId,
      occurredAt: ctx.occurredAt,
      remark: '销售出库冲销（Delivery 删除恢复库存）',
    });
  }
  return atoms;
}
