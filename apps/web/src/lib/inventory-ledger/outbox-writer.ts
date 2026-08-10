import { Prisma } from '@prisma/client';

/**
 * Sprint 6A - Outbox Writer（Transactional Outbox 写入，P1/P8 Final）
 * 职责：在**业务事实事务内**（如 WarehouseReceipt POST / PurchaseReturn RETURN）原子写 OutboxMessage，
 * 保证"业务事实 + Outbox 同事务成功或同事务失败"——库存链不再依赖 best-effort 事件发布（CTO #7508）。
 *
 * 原子级 Outbox 设计（CTO #7469/#7495）：
 * - 一条 Outbox 消息 = 一条未来的 InventoryMovement 原子（serial-managed 每 serial 一条、quantity=1；非 serial 一条 BULK）；
 * - `idempotencyKey` = 五元幂等键 `sourceType|sourceId|sourceLineId|movementRole|movementAtomKey`，
 *   与 InventoryMovement 的五元 UNIQUE 完全一致——Outbox 层防重复、Movement 层防重复，两关独立；
 * - serial 原子身份：`serialNo != null ⇒ movementAtomKey == serialNo`（DB CHECK `InventoryMovement_serial_atom_key_check`）。
 *
 * Consumer（第二步，CTO 后批）将：claim Outbox → PROCESSING lease → resolve source → atomize serial →
 * 五元幂等 → 锁五维 StockProjection → 禁负库存 → INSERT Movement + UPSERT Projection + MARK PROCESSED 同事务。
 * dimensionKey 仅辅助查询/锁键；真正库存身份 = (warehouseId, locationId, itemId, batchNo, serialNo) 五维 DB 唯一。
 */

export type InventoryOutboxSourceType =
  | 'WAREHOUSE_RECEIPT_POSTED' // WarehouseReceiptPosted → IN（5B 来源）
  | 'PURCHASE_RETURN_RETURNED'; // PurchaseReturned（仅 WAREHOUSE_RECEIPT_LINE 来源行）→ OUT（5B 来源）

export type InventoryOutboxMovementRole = 'IN' | 'OUT';

export interface InventoryOutboxAtom {
  sourceType: InventoryOutboxSourceType;
  sourceId: string; // 来源单据 id（WarehouseReceipt.id / PurchaseReturn.id）
  sourceLineId: string; // 来源行 id（WarehouseReceiptLine.id / PurchaseReturnLine.id）
  movementRole: InventoryOutboxMovementRole;
  movementAtomKey: string; // 非 serial = 'BULK'；serial-managed = serialNo（DB CHECK 强制 serial 时 == serialNo）
  // 库存维度（P9：已入库退货按原 WarehouseReceiptLine 的 warehouse/location/batch/serial 精确 OUT）
  warehouseId: string;
  locationId?: string | null;
  itemId?: string | null;
  batchNo?: string | null;
  serialNo?: string | null;
  quantity: Prisma.Decimal; // serial-managed = 1；非 serial = 行数量
  uomId?: string | null;
  mfgDate?: Date | null;
  expDate?: Date | null;
  // 事件基础字段（对齐 EVENTS.md 载荷；不含库存余额）
  eventType: 'WarehouseReceiptPosted' | 'PurchaseReturned';
  aggregateType: 'WarehouseReceipt' | 'PurchaseReturn';
  aggregateId: string;
  referenceNo?: string | null; // 单据号（可读追溯）
  actorId?: string | null;
  occurredAt: string; // ISO（postedAt / returnedAt）
}

/** 在业务事务内写一条原子级 Outbox 消息（幂等键 = 五元；重复写 → P2002 → 事务回滚，符合"同事务失败"） */
export async function writeInventoryOutboxAtom(tx: Prisma.TransactionClient, atom: InventoryOutboxAtom) {
  const idempotencyKey = [
    atom.sourceType,
    atom.sourceId,
    atom.sourceLineId,
    atom.movementRole,
    atom.movementAtomKey,
  ].join('|');
  await tx.outboxMessage.create({
    data: {
      eventType: atom.eventType,
      aggregateType: atom.aggregateType,
      aggregateId: atom.aggregateId,
      payload: {
        // 库存链原子信息（Consumer resolve source 用）
        sourceType: atom.sourceType,
        sourceId: atom.sourceId,
        sourceLineId: atom.sourceLineId,
        movementRole: atom.movementRole,
        movementAtomKey: atom.movementAtomKey,
        warehouseId: atom.warehouseId,
        locationId: atom.locationId ?? null,
        itemId: atom.itemId ?? null,
        batchNo: atom.batchNo ?? null,
        serialNo: atom.serialNo ?? null,
        quantity: atom.quantity.toString(),
        uomId: atom.uomId ?? null,
        mfgDate: atom.mfgDate?.toISOString() ?? null,
        expDate: atom.expDate?.toISOString() ?? null,
        // 事件载荷（对齐 EVENTS.md；不含库存余额）
        referenceNo: atom.referenceNo ?? null,
        actorId: atom.actorId ?? null,
        occurredAt: atom.occurredAt,
      },
      idempotencyKey,
      status: 'PENDING',
      attemptCount: 0,
    },
  });
}

/**
 * 将一条来源行展开为原子列表：
 * - serial-managed（serialNos 非空）：每 serial 一条（movementAtomKey=serialNo、serialNo=serialNo、quantity=1）；
 * - 非 serial（serialNos 为空）：一条（movementAtomKey='BULK'、serialNo=null、quantity=行数量）。
 */
export function expandSourceLineAtoms(params: {
  sourceType: InventoryOutboxSourceType;
  sourceId: string;
  sourceLineId: string;
  movementRole: InventoryOutboxMovementRole;
  warehouseId: string;
  locationId?: string | null;
  itemId?: string | null;
  batchNo?: string | null;
  serialNos: string[];
  quantity: Prisma.Decimal;
  uomId?: string | null;
  mfgDate?: Date | null;
  expDate?: Date | null;
  eventType: 'WarehouseReceiptPosted' | 'PurchaseReturned';
  aggregateType: 'WarehouseReceipt' | 'PurchaseReturn';
  aggregateId: string;
  referenceNo?: string | null;
  actorId?: string | null;
  occurredAt: string;
}): InventoryOutboxAtom[] {
  const base = { ...params };
  if (base.serialNos.length > 0) {
    // serial-managed：每 serial 一条原子 Movement（quantity=1；DB CHECK serialNo 时 atomKey==serialNo）
    return base.serialNos.map((serialNo) => ({
      sourceType: base.sourceType,
      sourceId: base.sourceId,
      sourceLineId: base.sourceLineId,
      movementRole: base.movementRole,
      movementAtomKey: serialNo,
      warehouseId: base.warehouseId,
      locationId: base.locationId,
      itemId: base.itemId,
      batchNo: base.batchNo,
      serialNo,
      quantity: new Prisma.Decimal(1),
      uomId: base.uomId,
      mfgDate: base.mfgDate,
      expDate: base.expDate,
      eventType: base.eventType,
      aggregateType: base.aggregateType,
      aggregateId: base.aggregateId,
      referenceNo: base.referenceNo,
      actorId: base.actorId,
      occurredAt: base.occurredAt,
    }));
  }
  // 非 serial：BULK 一条
  return [
    {
      sourceType: base.sourceType,
      sourceId: base.sourceId,
      sourceLineId: base.sourceLineId,
      movementRole: base.movementRole,
      movementAtomKey: 'BULK',
      warehouseId: base.warehouseId,
      locationId: base.locationId,
      itemId: base.itemId,
      batchNo: base.batchNo,
      serialNo: null,
      quantity: base.quantity,
      uomId: base.uomId,
      mfgDate: base.mfgDate,
      expDate: base.expDate,
      eventType: base.eventType,
      aggregateType: base.aggregateType,
      aggregateId: base.aggregateId,
      referenceNo: base.referenceNo,
      actorId: base.actorId,
      occurredAt: base.occurredAt,
    },
  ];
}
