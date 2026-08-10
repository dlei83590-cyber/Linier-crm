import { Prisma } from '@prisma/client';
import type { ErrorCode } from '@/lib/api/errors';

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
 * 严格 invariant（CTO #7543，Outbox Writer Review Blocking ①/②）：
 * - **数量守恒**：serial-managed（serialNos 非空）→ quantity 必须是整数 → serialNos.length == quantity
 *   → serialNos 内不得重复；否则抛 `InventoryOutboxError`（稳定错误码）让整个 POST/RETURN 事务回滚——
 *   绝不允许"业务事实 2 件、Outbox 却可靠写入 3 件"（Transactional Outbox 会把错误事实永久固化）；
 * - **canonical dimensions 必填**：itemId 为 Outbox 必填维度（InventoryMovement.itemId NOT NULL）；
 *   warehouseId / itemId / quantity>0 缺失即抛 `INVENTORY_DIMENSION_INCOMPLETE`（409）→ 事务回滚，
 *   绝不让 Consumer 处理本来就不可能成功的 poison Outbox；location/batch/serial 按设计可空。
 *
 * Consumer（第二步，CTO 后批）将：claim Outbox → PROCESSING lease → resolve source → atomize serial →
 * 五元幂等 → 锁五维 StockProjection → 禁负库存 → INSERT Movement + UPSERT Projection + MARK PROCESSED 同事务。
 * dimensionKey 仅辅助查询/锁键；真正库存身份 = (warehouseId, locationId, itemId, batchNo, serialNo) 五维 DB 唯一。
 */

/** Outbox invariant 违反（稳定错误码，路由 catch 后返回 409/400，绝不落成 500） */
export class InventoryOutboxError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'InventoryOutboxError';
  }
}

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
  itemId: string; // **必填**（CTO #7543 Blocking ②：InventoryMovement.itemId NOT NULL，禁止 poison Outbox）
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
        itemId: atom.itemId,
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
 * 将一条来源行展开为原子列表——**严格 invariant helper（CTO #7543 Blocking ①）**：
 * - canonical dimensions 必填：warehouseId / itemId / quantity>0（Blocking ② poison Outbox 防线）；
 * - serial-managed（serialNos 非空）：
 *   - quantity 必须是整数；
 *   - `serialNos.length == quantity`（数量守恒——Outbox 原子数必须等于业务数量）；
 *   - serialNos 内不得重复；
 *   - 每 serial 一条原子（movementAtomKey=serialNo、serialNo=serialNo、quantity=1）；
 * - 非 serial（serialNos 为空）：一条（movementAtomKey='BULK'、serialNo=null、quantity=行数量）。
 * 违反任一 invariant → 抛 `InventoryOutboxError`（稳定错误码）→ 调用方事务整体回滚。
 */
export function expandSourceLineAtoms(params: {
  sourceType: InventoryOutboxSourceType;
  sourceId: string;
  sourceLineId: string;
  movementRole: InventoryOutboxMovementRole;
  warehouseId: string;
  locationId?: string | null;
  itemId: string; // 必填（Blocking ②）
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

  // canonical dimensions（Blocking ②）：缺失 → poison Outbox，直接事务失败
  if (!base.warehouseId) {
    throw new InventoryOutboxError(
      'INVENTORY_DIMENSION_INCOMPLETE',
      '库存维度不完整：warehouseId 缺失（无法生成库存 Movement）',
    );
  }
  if (!base.itemId) {
    throw new InventoryOutboxError(
      'INVENTORY_DIMENSION_INCOMPLETE',
      '库存维度不完整：itemId 缺失（InventoryMovement.itemId NOT NULL，禁止 poison Outbox）',
    );
  }
  if (base.quantity.lte(0)) {
    throw new InventoryOutboxError(
      'INVENTORY_DIMENSION_INCOMPLETE',
      `库存数量必须 > 0（当前 ${base.quantity}）`,
    );
  }

  if (base.serialNos.length > 0) {
    // serial-managed（Blocking ① 数量守恒）
    // 注意（CTO #7563）：数量比较必须全程基于 Prisma.Decimal——先判整数，再与 serialNos.length 精确比较，
    // 不要用 Number(quantity)/toNumber() 做关键比较（Decimal → Number 有边界风险）。
    if (!base.quantity.isInteger()) {
      throw new InventoryOutboxError(
        'INVENTORY_SERIAL_QTY_MISMATCH',
        `serial-managed 数量必须是整数（当前 ${base.quantity}）`,
      );
    }
    if (!base.quantity.equals(new Prisma.Decimal(base.serialNos.length))) {
      throw new InventoryOutboxError(
        'INVENTORY_SERIAL_QTY_MISMATCH',
        `序列号数量不守恒：serialNos(${base.serialNos.length}) != quantity(${base.quantity})`,
      );
    }
    if (new Set(base.serialNos).size !== base.serialNos.length) {
      throw new InventoryOutboxError(
        'INVENTORY_SERIAL_DUPLICATE',
        '序列号列表内存在重复 serial（每个 serial 必须是唯一原子）',
      );
    }
    // 每 serial 一条原子 Movement（quantity=1；DB CHECK serialNo 时 atomKey==serialNo）
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
