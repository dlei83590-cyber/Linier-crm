import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { ErrorCode } from '@/lib/api/errors';
import { publishInventoryMovementCommitted } from './events';

/**
 * Sprint 6A - Inventory Ledger Command + Consumer（CTO #7588 FINAL APPROVED：Inventory Consumer + Ledger Command HOLD 解除）
 *
 * 职责：可靠地把业务 Outbox（WAREHOUSE_RECEIPT_POSTED → IN / PURCHASE_RETURN_RETURNED → OUT）消费为
 * **不可变 InventoryMovement(COMMITTED)** 并同步维护 **StockProjection（物化投影）**。
 *
 * Consumer canonical 流程（CTO #7588 锁死）：
 *   claim PENDING/retryable Outbox（**FOR UPDATE SKIP LOCKED** 防双 worker）
 *   → PROCESSING + lease（lockedAt/lockedBy）
 *   → validate payload / resolve source（来源单据状态校验）
 *   → 五元幂等检查（sourceType|sourceId|sourceLineId|movementRole|movementAtomKey；P2002 兜底）
 *   → 锁五维 StockProjection（warehouseId+locationId+itemId+batchNo+serialNo，**不用 dimensionKey 当身份**）
 *   → OUT 检查 onHandQty >= quantity（禁负库存；不足 = 业务失败 → retry 退避 → 超阈值 DEAD_LETTER）
 *   → INSERT InventoryMovement(COMMITTED)
 *   → UPSERT StockProjection（onHandQty += signedQty，同事务）
 *   → MARK Outbox PROCESSED（同事务）
 *   → COMMIT
 *   → 发布 InventoryMovementCommitted（事务提交后 best-effort，载荷不含投影余额）
 *
 * 三并发点（CTO #7588）：
 * 1. claim：`FOR UPDATE SKIP LOCKED` 原子领取，双 worker 不会消费同一 Outbox；
 * 2. Movement 幂等：五元 UNIQUE（DB 层）——lease 超时/worker crash/消息重试都不会重复入账；
 * 3. 同五维多 OUT 串行：五维行 FOR UPDATE 锁，第二个 OUT 等第一个提交后看到新余额，防一起扣成负数。
 *
 * 事务边界：**Movement + StockProjection + Outbox PROCESSED 同事务**（单条 Outbox 一个事务）。
 * OUT 库存不足 → 事务回滚（Movement 不写、Projection 不变、Outbox 不误标 PROCESSED），
 * Outbox 回 PENDING + 指数退避重试；超过 MAX_ATTEMPTS → DEAD_LETTER（永久业务失败）。
 */

/** Consumer 配置（可调） */
export const OUTBOX_BATCH_SIZE = 20; // 每轮 claim 上限
export const OUTBOX_MAX_ATTEMPTS = 10; // 超过该尝试次数 → DEAD_LETTER
export const OUTBOX_RETRY_BASE_SECONDS = 5; // 指数退避基数：nextAttemptAt = now + base * 2^(attempt-1)
export const OUTBOX_RETRY_CAP_SECONDS = 300; // 退避上限 5 分钟

/** 稳定错误码（复用 errors.ts 既有 5 个 + 新 2 个，全部 409 语义） */
export const INVENTORY_CONSUMER_ERRORS = {
  OUTBOX_PAYLOAD_INVALID: 'INVENTORY_OUTBOX_PAYLOAD_INVALID', // payload 缺失/类型错误（永久失败 → DEAD_LETTER）
  INVENTORY_SOURCE_NOT_FOUND: 'INVENTORY_SOURCE_NOT_FOUND', // resolve source：来源单据不存在或状态不符（永久失败 → DEAD_LETTER）
  INVENTORY_INSUFFICIENT_STOCK: 'INVENTORY_INSUFFICIENT_STOCK', // OUT 余额不足（业务失败 → retry → DEAD_LETTER）
} as const satisfies Record<string, ErrorCode>;

/** 单条 Outbox 消费结果（批处理统计用） */
export interface ConsumeOutboxResult {
  outboxId: string;
  outcome: 'PROCESSED' | 'ALREADY_PROCESSED' | 'RETRY' | 'DEAD_LETTER' | 'LEASE_LOST';
  movementId?: string;
  movementNo?: string;
  error?: string;
}

export interface ConsumeBatchResult {
  claimed: number;
  processed: number;
  retried: number;
  deadLettered: number;
  leaseLost: number;
  results: ConsumeOutboxResult[];
}

type Payload = Record<string, unknown>;

/** 从 Outbox payload 解析库存原子（validate payload；缺失/类型错误 → INVENTORY_OUTBOX_PAYLOAD_INVALID） */
function parseAtomPayload(payload: unknown): {
  ok: true;
  atom: {
    sourceType: 'WAREHOUSE_RECEIPT_POSTED' | 'PURCHASE_RETURN_RETURNED';
    sourceId: string;
    sourceLineId: string;
    movementRole: 'IN' | 'OUT';
    movementAtomKey: string;
    warehouseId: string;
    locationId: string | null;
    itemId: string;
    batchNo: string | null;
    serialNo: string | null;
    quantity: Prisma.Decimal;
    uomId: string | null;
    mfgDate: Date | null;
    expDate: Date | null;
    referenceNo: string | null;
    actorId: string | null;
    occurredAt: string;
  };
} | { ok: false; error: string } {
  const p = payload as Payload | null;
  if (!p || typeof p !== 'object') return { ok: false, error: 'payload 缺失' };
  const srcType = p.sourceType;
  if (srcType !== 'WAREHOUSE_RECEIPT_POSTED' && srcType !== 'PURCHASE_RETURN_RETURNED') {
    return { ok: false, error: `未知 sourceType: ${String(srcType)}` };
  }
  const role = p.movementRole;
  if (role !== 'IN' && role !== 'OUT') return { ok: false, error: `未知 movementRole: ${String(role)}` };
  const need = (v: unknown, _name: string): string | null =>
    typeof v === 'string' && v.length > 0 ? v : null;
  const sourceId = need(p.sourceId, 'sourceId');
  const sourceLineId = need(p.sourceLineId, 'sourceLineId');
  const movementAtomKey = need(p.movementAtomKey, 'movementAtomKey');
  const warehouseId = need(p.warehouseId, 'warehouseId');
  const itemId = need(p.itemId, 'itemId');
  const quantityRaw = p.quantity;
  if (!sourceId || !sourceLineId || !movementAtomKey || !warehouseId || !itemId) {
    return { ok: false, error: '五元键/canonical dimensions 缺失（sourceId/sourceLineId/movementAtomKey/warehouseId/itemId）' };
  }
  let quantity: Prisma.Decimal;
  try {
    quantity = new Prisma.Decimal(String(quantityRaw));
  } catch {
    return { ok: false, error: `quantity 非法: ${String(quantityRaw)}` };
  }
  if (quantity.lte(0)) return { ok: false, error: `quantity 必须 > 0（当前 ${quantity}）` };
  // serial 原子一致性（DB CHECK 同源）：serialNo 存在 → movementAtomKey == serialNo
  const serialNo = typeof p.serialNo === 'string' && p.serialNo.length > 0 ? p.serialNo : null;
  if (serialNo && movementAtomKey !== serialNo) {
    return { ok: false, error: `serial 原子身份不一致：movementAtomKey(${movementAtomKey}) != serialNo(${serialNo})` };
  }
  // 注意（CTO #7644 顺手修）：非 serial → movementAtomKey === 'BULK' 是**当前两种 consumer source 的规则**
  // （WAREHOUSE_RECEIPT_POSTED / PURCHASE_RETURN_RETURNED，Writer 原子化时非 serial 即 BULK）；
  // **不是全局 Ledger invariant**——6A Schema 已允许未来非 serial Transfer/Conversion 使用多个 atom key。
  if (!serialNo && movementAtomKey !== 'BULK') {
    return { ok: false, error: `非 serial 原子 movementAtomKey 必须为 BULK（当前 ${movementAtomKey}）` };
  }
  return {
    ok: true,
    atom: {
      sourceType: srcType,
      sourceId,
      sourceLineId,
      movementRole: role,
      movementAtomKey,
      warehouseId,
      locationId: typeof p.locationId === 'string' && p.locationId.length > 0 ? p.locationId : null,
      itemId,
      batchNo: typeof p.batchNo === 'string' && p.batchNo.length > 0 ? p.batchNo : null,
      serialNo,
      quantity,
      uomId: typeof p.uomId === 'string' && p.uomId.length > 0 ? p.uomId : null,
      mfgDate: typeof p.mfgDate === 'string' ? new Date(p.mfgDate) : null,
      expDate: typeof p.expDate === 'string' ? new Date(p.expDate) : null,
      referenceNo: typeof p.referenceNo === 'string' && p.referenceNo.length > 0 ? p.referenceNo : null,
      actorId: typeof p.actorId === 'string' && p.actorId.length > 0 ? p.actorId : null,
      occurredAt: typeof p.occurredAt === 'string' ? p.occurredAt : new Date().toISOString(),
    },
  };
}

/** resolve source：校验来源单据存在且状态正确（永久失败 → DEAD_LETTER） */
async function resolveSource(
  tx: Prisma.TransactionClient,
  sourceType: 'WAREHOUSE_RECEIPT_POSTED' | 'PURCHASE_RETURN_RETURNED',
  sourceId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (sourceType === 'WAREHOUSE_RECEIPT_POSTED') {
    const wr = await tx.warehouseReceipt.findFirst({
      where: { id: sourceId, deletedAt: null },
      select: { status: true },
    });
    if (!wr) return { ok: false, error: `WarehouseReceipt ${sourceId} 不存在或已删除` };
    if (wr.status !== 'POSTED') return { ok: false, error: `WarehouseReceipt ${sourceId} 状态 ${wr.status} ≠ POSTED` };
    return { ok: true };
  }
  const prt = await tx.purchaseReturn.findFirst({
    where: { id: sourceId, deletedAt: null },
    select: { status: true },
  });
  if (!prt) return { ok: false, error: `PurchaseReturn ${sourceId} 不存在或已删除` };
  if (prt.status !== 'RETURNED') return { ok: false, error: `PurchaseReturn ${sourceId} 状态 ${prt.status} ≠ RETURNED` };
  return { ok: true };
}

/** DocumentSequence 原子取号（docType=INVENTORY_MOVEMENT，前缀 MV，位数 6）
 * CTO #7667 Minor：**禁止 fallback `MV000001`**——DocumentSequence 缺失 = 配置错误，直接抛错
 * （外层 catch → RETRY 退避；运维建好 sequence 后自然恢复），绝不生成常量 1 二次撞 movementNo UNIQUE。
 */
export async function nextInventoryMovementNo(tx: Prisma.TransactionClient): Promise<string> {
  const seq = await tx.documentSequence.findFirst({
    where: { docType: 'INVENTORY_MOVEMENT', isActive: true, deletedAt: null },
  });
  if (!seq) {
    throw new Error(
      'InventoryMovement DocumentSequence 缺失（docType=INVENTORY_MOVEMENT）：Consumer 配置错误，需先 Seed sequence 才能生成 movementNo',
    );
  }
  const prefix = seq.prefix ?? 'MV';
  const padLength = seq.padLength ?? 6;
  const updated = await tx.documentSequence.update({
    where: { id: seq.id },
    data: { nextNo: { increment: 1 } },
  });
  return `${prefix}${String(updated.nextNo - 1).padStart(padLength, '0')}`;
}

/** 五维维度 → dimensionKey（**仅查询/锁键辅助，非库存身份**——CTO #7469/#7588） */
export function buildDimensionKey(dims: {
  warehouseId: string;
  locationId: string | null;
  itemId: string;
  batchNo: string | null;
  serialNo: string | null;
}): string {
  return [
    dims.warehouseId,
    dims.locationId ?? '\u0000',
    dims.itemId,
    dims.batchNo ?? '\u0000',
    dims.serialNo ?? '\u0000',
  ].join('|');
}

/**
 * 锁五维 StockProjection 行（**FOR UPDATE；NULL 用 IS NOT DISTINCT FROM 匹配**——五维 NULLS NOT DISTINCT 语义）；
 * 不存在则**原子创建**（CTO #7644 Blocking ②）：`INSERT ... ON CONFLICT (五维) DO NOTHING` 后再 `SELECT ... FOR UPDATE`。
 * 注意：**不能**用 Prisma create + catch P2002 后同事务重查——PG unique violation 会把当前事务打进
 * aborted state，catch JS 异常不能恢复数据库事务；ON CONFLICT DO NOTHING 不产生 SQL error，事务保持可用。
 * 身份基于**真正五维 NULLS NOT DISTINCT 唯一索引**（StockProjection_dimension_unique），不退回 dimensionKey。
 */
async function lockOrCreateProjection(
  tx: Prisma.TransactionClient,
  dims: { warehouseId: string; locationId: string | null; itemId: string; batchNo: string | null; serialNo: string | null },
): Promise<{ id: string; onHandQty: Prisma.Decimal; version: number }> {
  // 原子创建（冲突无事发生）：INSERT ... ON CONFLICT (五维) DO NOTHING（PG16 NULLS NOT DISTINCT 唯一索引为 arbiter）
  // **CTO #7667 Blocking ①**：raw SQL 绕过 Prisma，`@default(cuid())` 不再自动生成——必须显式生成并写 `id`
  // （Migration 0025 `"id" TEXT NOT NULL` 无 DB DEFAULT，缺 id 首笔新维度会直接 NOT NULL 失败）
  const projectionId = crypto.randomUUID();
  await tx.$executeRaw(
    Prisma.sql`INSERT INTO "StockProjection"
        ("id", "warehouseId", "locationId", "itemId", "batchNo", "serialNo", "dimensionKey")
      VALUES (${projectionId}, ${dims.warehouseId}, ${dims.locationId}, ${dims.itemId}, ${dims.batchNo}, ${dims.serialNo}, ${buildDimensionKey(dims)})
      ON CONFLICT ("warehouseId", "locationId", "itemId", "batchNo", "serialNo") DO NOTHING`,
  );
  // 锁行（无论刚创建还是已存在，都能锁到同一五维行——同维度多 OUT 串行防负库存）
  const rows = await tx.$queryRaw<Array<{ id: string; onHandQty: Prisma.Decimal; version: number }>>(
    Prisma.sql`SELECT "id", "onHandQty", "version" FROM "StockProjection"
      WHERE "warehouseId" = ${dims.warehouseId}
        AND "locationId" IS NOT DISTINCT FROM ${dims.locationId}
        AND "itemId" = ${dims.itemId}
        AND "batchNo" IS NOT DISTINCT FROM ${dims.batchNo}
        AND "serialNo" IS NOT DISTINCT FROM ${dims.serialNo}
      FOR UPDATE`,
  );
  if (rows.length === 0) {
    // 理论上不可达（INSERT 后必有行）；防御性错误，事务回滚
    throw new Error(
      `StockProjection 五维行创建后不可达：${dims.warehouseId}/${dims.locationId ?? '-'}/${dims.itemId}/${dims.batchNo ?? '-'}/${dims.serialNo ?? '-'}`,
    );
  }
  return { id: rows[0].id, onHandQty: new Prisma.Decimal(rows[0].onHandQty.toString()), version: rows[0].version };
}

/** 五元幂等预检：同五元 Movement 已存在 → 幂等重放（直接标 PROCESSED，不重复入账） */
async function findExistingMovement(
  tx: Prisma.TransactionClient,
  atom: {
    sourceType: 'WAREHOUSE_RECEIPT_POSTED' | 'PURCHASE_RETURN_RETURNED';
    sourceId: string;
    sourceLineId: string;
    movementRole: 'IN' | 'OUT';
    movementAtomKey: string;
  },
) {
  return tx.inventoryMovement.findFirst({
    where: {
      sourceType: atom.sourceType,
      sourceId: atom.sourceId,
      sourceLineId: atom.sourceLineId,
      movementRole: atom.movementRole,
      movementAtomKey: atom.movementAtomKey,
    },
    select: { id: true, movementNo: true },
  });
}

/**
 * 处理单条 Outbox（**单事务**：Movement + Projection + Outbox PROCESSED 同事务）。
 * - lease fencing（CTO #7644 Blocking ①）：事务开始先验证 Outbox 仍由本 worker 持有
 *   （status=PROCESSING AND lockedBy=workerId，FOR UPDATE 锁行）；不满足 → LEASE_LOST，
 *   旧 worker 禁止继续业务处理（防 lease 回收后新旧 worker 并发穿透）；
 * - 幂等：五元预检（快路径）→ INSERT ... ON CONFLICT DO NOTHING RETURNING（原子冲突语义，不制造 SQL error）；
 * - 锁五维 Projection（FOR UPDATE）→ OUT 检查 onHandQty >= quantity；
 * - 成功：INSERT Movement(COMMITTED) + UPSERT Projection + MARK Outbox PROCESSED（均带 ownership 条件）；
 * - 业务失败（库存不足）→ 抛 InventoryInsufficientStockError（外层转 RETRY/DEAD_LETTER）。
 */
export async function consumeOutboxMessage(
  outboxId: string,
  workerId: string,
  eventType: string,
  payload: unknown,
): Promise<ConsumeOutboxResult> {
  return prisma.$transaction(async (tx) => {
    // Blocking ① lease fencing：事务开始验证 ownership 并锁 Outbox 行（防 lease 回收后旧 worker 继续处理）
    const owned = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "OutboxMessage"
        WHERE "id" = ${outboxId} AND "status" = 'PROCESSING' AND "lockedBy" = ${workerId}
        FOR UPDATE`,
    );
    if (owned.length === 0) {
      return { outboxId, outcome: 'LEASE_LOST' as const };
    }

    const parsed = parseAtomPayload(payload);
    if (!parsed.ok) {
      // 永久失败：payload 非法 → DEAD_LETTER（带 ownership 条件）
      const upd = await tx.outboxMessage.updateMany({
        where: { id: outboxId, status: 'PROCESSING', lockedBy: workerId },
        data: { status: 'DEAD_LETTER', lastError: `payload 非法: ${parsed.error}`, processedAt: new Date() },
      });
      if (upd.count !== 1) return { outboxId, outcome: 'LEASE_LOST' as const };
      return { outboxId, outcome: 'DEAD_LETTER' as const, error: parsed.error };
    }
    const atom = parsed.atom;

    // resolve source（永久失败 → DEAD_LETTER；带 ownership 条件）
    const src = await resolveSource(tx, atom.sourceType, atom.sourceId);
    if (!src.ok) {
      const upd = await tx.outboxMessage.updateMany({
        where: { id: outboxId, status: 'PROCESSING', lockedBy: workerId },
        data: { status: 'DEAD_LETTER', lastError: src.error, processedAt: new Date() },
      });
      if (upd.count !== 1) return { outboxId, outcome: 'LEASE_LOST' as const };
      return { outboxId, outcome: 'DEAD_LETTER' as const, error: src.error };
    }

    // 五元幂等：预检（快路径）——已存在 → 直接标 PROCESSED（幂等重放；带 ownership 条件）
    const existing = await findExistingMovement(tx, atom);
    if (existing) {
      const upd = await tx.outboxMessage.updateMany({
        where: { id: outboxId, status: 'PROCESSING', lockedBy: workerId },
        data: { status: 'PROCESSED', processedAt: new Date(), lastError: null },
      });
      if (upd.count !== 1) return { outboxId, outcome: 'LEASE_LOST' as const };
      return { outboxId, outcome: 'ALREADY_PROCESSED' as const, movementId: existing.id, movementNo: existing.movementNo };
    }

    // 锁五维 StockProjection（FOR UPDATE；**不用 dimensionKey 当身份**）
    const projection = await lockOrCreateProjection(tx, {
      warehouseId: atom.warehouseId,
      locationId: atom.locationId,
      itemId: atom.itemId,
      batchNo: atom.batchNo,
      serialNo: atom.serialNo,
    });

    // OUT 负库存检查（业务失败：Movement 不写、Projection 不变、Outbox 不误标 PROCESSED）
    const signedQty = atom.movementRole === 'IN' ? atom.quantity : atom.quantity.negated();
    if (atom.movementRole === 'OUT' && projection.onHandQty.lt(atom.quantity)) {
      throw new InventoryInsufficientStockError(
        `库存不足：onHandQty(${projection.onHandQty}) < OUT quantity(${atom.quantity}) [${atom.warehouseId}/${atom.locationId ?? '-'}/${atom.itemId}/${atom.batchNo ?? '-'}/${atom.serialNo ?? '-'}]`,
      );
    }

    // movementNo 取号（同事务原子 increment）
    const movementNo = await nextInventoryMovementNo(tx);

    // Blocking ③：Movement INSERT 用 PG 原子冲突语义——ON CONFLICT (五元) DO NOTHING RETURNING id，
    // 不制造 SQL error 再同事务恢复（P2002 catch 后事务已 aborted，不可恢复）
    // **CTO #7667 Blocking ②**：raw SQL 绕过 Prisma，`@default(cuid())` 不再自动生成——必须显式生成并写 `id`
    // （Migration 0025 `"id" TEXT NOT NULL` 无 DB DEFAULT；冲突未插入时 candidate id 无副作用）
    const movementIdCandidate = crypto.randomUUID();
    const inserted = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`INSERT INTO "InventoryMovement"
        ("id", "movementNo", "sourceType", "sourceId", "sourceLineId", "movementRole", "movementAtomKey",
         "direction", "status", "movementType",
         "warehouseId", "locationId", "itemId", "batchNo", "serialNo",
         "mfgDate", "expDate", "quantity", "uomId", "referenceNo", "committedById", "committedAt", "remark")
      VALUES (
        ${movementIdCandidate},
        ${movementNo},
        ${atom.sourceType}::"InventoryMovementSourceType",
        ${atom.sourceId},
        ${atom.sourceLineId},
        ${atom.movementRole}::"InventoryMovementRole",
        ${atom.movementAtomKey},
        ${atom.movementRole === 'IN' ? 'IN' : 'OUT'}::"InventoryMovementDirection",
        'COMMITTED'::"InventoryMovementStatus",
        ${atom.movementRole === 'IN' ? 'INBOUND' : 'OUTBOUND'}::"InventoryMovementType",
        ${atom.warehouseId},
        ${atom.locationId},
        ${atom.itemId},
        ${atom.batchNo},
        ${atom.serialNo},
        ${atom.mfgDate},
        ${atom.expDate},
        ${atom.quantity},
        ${atom.uomId},
        ${atom.referenceNo},
        ${atom.actorId},
        ${atom.occurredAt ? new Date(atom.occurredAt) : new Date()},
        ${`Outbox ${eventType}`}
      )
      ON CONFLICT ("sourceType", "sourceId", "sourceLineId", "movementRole", "movementAtomKey") DO NOTHING
      RETURNING "id"`,
    );

    let movementId: string;
    if (inserted.length === 1) {
      movementId = inserted[0].id;
    } else {
      // 幂等兜底：五元已存在（并发/重试）→ 查既有 Movement → 标 PROCESSED（带 ownership 条件）
      const dup = await findExistingMovement(tx, atom);
      if (!dup) {
        throw new Error(`Movement ON CONFLICT DO NOTHING 未插入且五元预检未命中（不可达）：${outboxId}`);
      }
      const upd = await tx.outboxMessage.updateMany({
        where: { id: outboxId, status: 'PROCESSING', lockedBy: workerId },
        data: { status: 'PROCESSED', processedAt: new Date(), lastError: null },
      });
      if (upd.count !== 1) return { outboxId, outcome: 'LEASE_LOST' as const };
      return { outboxId, outcome: 'ALREADY_PROCESSED' as const, movementId: dup.id, movementNo: dup.movementNo };
    }

    // UPSERT StockProjection（同事务：onHandQty += signedQty；version 乐观锁）
    const newQty = projection.onHandQty.plus(signedQty);
    await tx.stockProjection.update({
      where: { id: projection.id },
      data: {
        onHandQty: newQty,
        lastMovementAt: new Date(),
        version: { increment: 1 },
      },
    });

    // MARK Outbox PROCESSED（同事务——三件套原子提交；带 ownership 条件）
    const upd = await tx.outboxMessage.updateMany({
      where: { id: outboxId, status: 'PROCESSING', lockedBy: workerId },
      data: { status: 'PROCESSED', processedAt: new Date(), lastError: null },
    });
    if (upd.count !== 1) return { outboxId, outcome: 'LEASE_LOST' as const };

    return { outboxId, outcome: 'PROCESSED' as const, movementId, movementNo };
  });
}

/** OUT 库存不足（业务失败；外层 catch → RETRY 退避 → 超阈值 DEAD_LETTER） */
export class InventoryInsufficientStockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryInsufficientStockError';
  }
}

/**
 * Outbox 回 PENDING + 指数退避（瞬时/业务失败重试）；attemptCount 超阈值 → DEAD_LETTER（永久失败）。
 * **带 ownership 条件（CTO #7644 Blocking ①）**：仅当前 worker（status=PROCESSING AND lockedBy=workerId）
 * 能回滚/终结 lease；若 lease 已被回收（count≠1）→ LEASE_LOST，旧 worker 禁止改状态。
 */
async function markOutboxRetryOrDead(
  tx: Prisma.TransactionClient,
  outboxId: string,
  workerId: string,
  error: string,
  attemptCount: number,
): Promise<'RETRY' | 'DEAD_LETTER' | 'LEASE_LOST'> {
  const ownership = { id: outboxId, status: 'PROCESSING' as const, lockedBy: workerId };
  if (attemptCount >= OUTBOX_MAX_ATTEMPTS) {
    const upd = await tx.outboxMessage.updateMany({
      where: ownership,
      data: { status: 'DEAD_LETTER', lastError: error, processedAt: new Date() },
    });
    if (upd.count !== 1) return 'LEASE_LOST';
    return 'DEAD_LETTER';
  }
  const backoffSeconds = Math.min(OUTBOX_RETRY_BASE_SECONDS * 2 ** (attemptCount - 1), OUTBOX_RETRY_CAP_SECONDS);
  const upd = await tx.outboxMessage.updateMany({
    where: ownership,
    data: {
      status: 'PENDING',
      lastError: error,
      nextAttemptAt: new Date(Date.now() + backoffSeconds * 1000),
    },
  });
  if (upd.count !== 1) return 'LEASE_LOST';
  return 'RETRY';
}

/**
 * claim 一批 PENDING/retryable Outbox（**FOR UPDATE SKIP LOCKED** 原子领取 → PROCESSING + lease）。
 * 双 worker 并发安全：SKIP LOCKED 跳过已被锁行；领取即置 PROCESSING，同一条不会被两个 worker 同时消费。
 * 也回收过期的 PROCESSING lease（worker crash 后重试）。
 */
async function claimOutboxBatch(
  workerId: string,
  limit: number,
): Promise<Array<{ id: string; eventType: string; payload: unknown; attemptCount: number }>> {
  return prisma.$transaction(async (tx) => {
    const leaseTimeout = new Date(Date.now() - 10 * 60 * 1000); // lease 10 分钟过期
    const rows = await tx.$queryRaw<
      Array<{ id: string; eventType: string; payload: unknown; attemptCount: number }>
    >(
      Prisma.sql`UPDATE "OutboxMessage" SET
          "status" = 'PROCESSING',
          "lockedAt" = now(),
          "lockedBy" = ${workerId},
          "attemptCount" = "attemptCount" + 1,
          "updatedAt" = now()
        WHERE "id" IN (
          SELECT "id" FROM "OutboxMessage"
          WHERE ("status" = 'PENDING' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= now()))
             OR ("status" = 'PROCESSING' AND "lockedAt" IS NOT NULL AND "lockedAt" <= ${leaseTimeout})
          ORDER BY "createdAt" ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING "id", "eventType", "payload", "attemptCount"`,
    );
    return rows;
  });
}

/**
 * Consumer 批处理入口：claim → 逐条消费（每条独立事务）→ 统计。
 * 注意：claim 与单条处理**不共用事务**（claim 只负责领取 + lease；单条处理事务内做三件套原子提交）。
 */
export async function consumePendingOutboxBatch(limit: number = OUTBOX_BATCH_SIZE): Promise<ConsumeBatchResult> {
  const workerId = `consumer-${crypto.randomUUID()}`;
  const claimed = await claimOutboxBatch(workerId, limit);
  const results: ConsumeOutboxResult[] = [];
  for (const row of claimed) {
    try {
      // workerId 传入单条消费（CTO #7644 Blocking ① fencing）：事务内验证 status=PROCESSING AND lockedBy=workerId
      const r = await consumeOutboxMessage(row.id, workerId, row.eventType, row.payload);
      results.push(r);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 业务失败（库存不足）→ retry/DEAD_LETTER；其他（瞬时技术失败）→ 同样回 PENDING 退避；
      // 失败路径同样带 ownership 条件（仅 owner 能回滚 lease；已被回收 → LEASE_LOST）
      const outcome = await prisma.$transaction((tx) =>
        markOutboxRetryOrDead(tx, row.id, workerId, msg, row.attemptCount),
      );
      results.push({ outboxId: row.id, outcome, error: msg });
    }
  }
  return {
    claimed: claimed.length,
    processed: results.filter((r) => r.outcome === 'PROCESSED' || r.outcome === 'ALREADY_PROCESSED').length,
    retried: results.filter((r) => r.outcome === 'RETRY').length,
    deadLettered: results.filter((r) => r.outcome === 'DEAD_LETTER').length,
    leaseLost: results.filter((r) => r.outcome === 'LEASE_LOST').length,
    results,
  };
}

/**
 * Consumer 触发点（供 API route / cron 调用）：
 * claim 一批 → 逐条消费 → 对成功入账的 Movement 发布 InventoryMovementCommitted（事务提交后 best-effort，
 * 载荷对齐 EVENTS.md：movementId/movementNo/sourceType/sourceId/sourceLineId/movementRole/movementAtomKey/
 * direction/warehouseId/locationId/itemId/batchNo/serialNo/quantity/committedAt，**不含投影余额**）。
 */
export async function runInventoryConsumer(limit: number = OUTBOX_BATCH_SIZE): Promise<ConsumeBatchResult> {
  const batch = await consumePendingOutboxBatch(limit);
  for (const r of batch.results) {
    if (r.outcome === 'PROCESSED' && r.movementId && r.movementNo) {
      const mv = await prisma.inventoryMovement.findUnique({
        where: { id: r.movementId },
        select: {
          id: true,
          movementNo: true,
          sourceType: true,
          sourceId: true,
          sourceLineId: true,
          movementRole: true,
          movementAtomKey: true,
          direction: true,
          warehouseId: true,
          locationId: true,
          itemId: true,
          batchNo: true,
          serialNo: true,
          quantity: true,
          committedAt: true,
        },
      });
      if (mv) {
        try {
          await publishInventoryMovementCommitted({
            eventType: 'InventoryMovementCommitted',
            actorId: null,
            entityId: mv.id,
            payload: {
              movementId: mv.id,
              movementNo: mv.movementNo,
              sourceType: mv.sourceType,
              sourceId: mv.sourceId,
              sourceLineId: mv.sourceLineId,
              movementRole: mv.movementRole,
              movementAtomKey: mv.movementAtomKey,
              direction: mv.direction,
              warehouseId: mv.warehouseId,
              locationId: mv.locationId,
              itemId: mv.itemId,
              batchNo: mv.batchNo,
              serialNo: mv.serialNo,
              quantity: mv.quantity.toString(),
              committedAt: mv.committedAt.toISOString(),
            },
          });
        } catch {
          // best-effort：发布失败不阻断（Known Risk；事件总线落地后替换）
        }
      }
    }
  }
  return batch;
}
