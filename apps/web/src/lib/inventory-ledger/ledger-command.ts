import { Prisma } from '@prisma/client';
import type {
  InventoryMovementSourceType,
  InventoryMovementRole,
  InventoryMovementType,
  InventoryMovementDirection,
} from '@prisma/client';

/**
 * Sprint 6B-1 - Shared InventoryLedgerCommand Core（CTO 6B Schema Re-review #8116 97/100 FINAL APPROVED → APPROVED TO START）
 *
 * 目标（P12 实现前置，CTO #7975 锁死）：把 6A Consumer 里已 FINAL 的 Ledger 原子能力抽成**唯一共享核心**——
 * 6A Consumer 与 6B Transfer/Adjustment/Conversion 共用同一底层，不各写一套 Movement/Projection/锁逻辑。
 *
 * 共享 Core 承载（canonical 流程，CTO 锁死）：
 *   五元幂等 → 五维 Projection 定位/创建/锁（FOR UPDATE）→ OUT 禁负库存 → INSERT InventoryMovement → UPSERT StockProjection
 *
 * 三条硬约束（CTO 三个 Review Gate）：
 * 1. **caller-owned transaction**：所有函数接受调用方提供的 `Prisma.TransactionClient`，**内部绝不自行 `$transaction`**——
 *    否则 Transfer/Adjustment/Conversion 无法把「业务单据终态 + Movement + Projection」包进同一个事务；
 * 2. **多 atom 原子性**：`executeLedgerAtoms(tx, atoms)` 在同一 tx 内顺序执行，任一失败 → 调用方整体回滚（全有或全无），
 *    不是逐 atom 各自提交；
 * 3. **6A Consumer 语义零回归**：Consumer 只把内部 Ledger mutation 换成调用本 Core；claim / lease fencing / retry /
 *    Outbox 状态机 / 事件发布逻辑一律不动。
 *
 * 本文件不创建任何 API / Workflow / Seed / RBAC；Operations API 仍 HOLD（CTO 指令）。
 */

/** OUT 库存不足（业务失败；6A Consumer 外层 catch → RETRY 退避 → 超阈值 DEAD_LETTER） */
export class InventoryInsufficientStockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryInsufficientStockError';
  }
}

/** 单条 Ledger 原子（一次不可变库存变化的完整描述；quantity 为 canonical base UOM 正数） */
export interface LedgerAtom {
  // 五元幂等（DB UNIQUE：sourceType|sourceId|sourceLineId|movementRole|movementAtomKey）
  sourceType: InventoryMovementSourceType;
  sourceId: string;
  sourceLineId: string;
  movementRole: InventoryMovementRole;
  movementAtomKey: string;
  // 方向与细分类型（由调用方按业务语义声明；Core 不做隐式映射）
  direction: InventoryMovementDirection;
  movementType: InventoryMovementType;
  // 五维
  warehouseId: string;
  locationId: string | null;
  itemId: string;
  batchNo: string | null;
  serialNo: string | null;
  // 数量（canonical base UOM，恒正数；OUT 禁负库存按此校验）
  quantity: Prisma.Decimal;
  // 业务快照
  uomId: string | null;
  mfgDate: Date | null;
  expDate: Date | null;
  referenceNo: string | null;
  actorId: string | null;
  occurredAt: string; // ISO 字符串
  remark?: string | null;
}

/** 单 atom 执行结果（inserted=false = 五元幂等命中，未产生新 Movement） */
export interface ExecuteLedgerAtomResult {
  movementId: string;
  movementNo: string;
  inserted: boolean;
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
      'InventoryMovement DocumentSequence 缺失（docType=INVENTORY_MOVEMENT）：配置错误，需先 Seed sequence 才能生成 movementNo',
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

/**
 * 锁五维 StockProjection 行（**FOR UPDATE；NULL 用 IS NOT DISTINCT FROM 匹配**——五维 NULLS NOT DISTINCT 语义）；
 * 不存在则**原子创建**（CTO #7644 Blocking ②）：`INSERT ... ON CONFLICT (五维) DO NOTHING` 后再 `SELECT ... FOR UPDATE`。
 * 注意：**不能**用 Prisma create + catch P2002 后同事务重查——PG unique violation 会把当前事务打进
 * aborted state，catch JS 异常不能恢复数据库事务；ON CONFLICT DO NOTHING 不产生 SQL error，事务保持可用。
 * 身份基于**真正五维 NULLS NOT DISTINCT 唯一索引**（StockProjection_dimension_unique），不退回 dimensionKey。
 */
export async function lockOrCreateProjection(
  tx: Prisma.TransactionClient,
  dims: {
    warehouseId: string;
    locationId: string | null;
    itemId: string;
    batchNo: string | null;
    serialNo: string | null;
  },
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
  const rows = await tx.$queryRaw<
    Array<{ id: string; onHandQty: Prisma.Decimal; version: number }>
  >(
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
  return {
    id: rows[0].id,
    onHandQty: new Prisma.Decimal(rows[0].onHandQty.toString()),
    version: rows[0].version,
  };
}

/** 五元幂等预检：同五元 Movement 已存在 → 幂等重放（不重复入账） */
async function findExistingMovement(
  tx: Prisma.TransactionClient,
  atom: {
    sourceType: InventoryMovementSourceType;
    sourceId: string;
    sourceLineId: string;
    movementRole: InventoryMovementRole;
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
 * 执行单条 Ledger 原子（**在调用方事务内**——Core 绝不自行 `$transaction`）：
 * 五元幂等预检（快路径）→ 锁/创建五维 Projection（FOR UPDATE）→ OUT 禁负库存 → 取号 →
 * INSERT InventoryMovement(COMMITTED)（ON CONFLICT DO NOTHING RETURNING，不制造 SQL error）→ UPSERT Projection。
 *
 * - 幂等命中（五元已存在）→ 返回 { inserted: false, movementId, movementNo }（调用方按重放处理）；
 * - OUT 库存不足 → 抛 `InventoryInsufficientStockError`（事务由调用方决定回滚/重试）；
 * - serial 原子一致性由调用方保证（movementAtomKey == serialNo 规则属业务层，不在此强校验）。
 */
export async function executeLedgerAtom(
  tx: Prisma.TransactionClient,
  atom: LedgerAtom,
): Promise<ExecuteLedgerAtomResult> {
  // 五元幂等：预检（快路径）——已存在 → 直接返回（幂等重放）
  const existing = await findExistingMovement(tx, atom);
  if (existing) {
    return { inserted: false, movementId: existing.id, movementNo: existing.movementNo };
  }

  // 锁五维 StockProjection（FOR UPDATE；**不用 dimensionKey 当身份**）
  const projection = await lockOrCreateProjection(tx, {
    warehouseId: atom.warehouseId,
    locationId: atom.locationId,
    itemId: atom.itemId,
    batchNo: atom.batchNo,
    serialNo: atom.serialNo,
  });

  // OUT 禁负库存检查（业务失败：Movement 不写、Projection 不变——事务回滚由调用方负责）
  const signedQty = atom.direction === 'IN' ? atom.quantity : atom.quantity.negated();
  if (atom.direction === 'OUT' && projection.onHandQty.lt(atom.quantity)) {
    throw new InventoryInsufficientStockError(
      `库存不足：onHandQty(${projection.onHandQty}) < OUT quantity(${atom.quantity}) [${atom.warehouseId}/${atom.locationId ?? '-'}/${atom.itemId}/${atom.batchNo ?? '-'}/${atom.serialNo ?? '-'}]`,
    );
  }

  // movementNo 取号（同事务原子 increment）
  const movementNo = await nextInventoryMovementNo(tx);

  // Movement INSERT 用 PG 原子冲突语义——ON CONFLICT (五元) DO NOTHING RETURNING id，
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
      ${atom.direction}::"InventoryMovementDirection",
      'COMMITTED'::"InventoryMovementStatus",
      ${atom.movementType}::"InventoryMovementType",
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
      ${atom.remark ?? null}
    )
    ON CONFLICT ("sourceType", "sourceId", "sourceLineId", "movementRole", "movementAtomKey") DO NOTHING
    RETURNING "id"`,
  );

  let movementId: string;
  if (inserted.length === 1) {
    movementId = inserted[0].id;
  } else {
    // 幂等兜底：五元已存在（并发/重试）→ 查既有 Movement → 幂等重放
    const dup = await findExistingMovement(tx, atom);
    if (!dup) {
      throw new Error(`Movement ON CONFLICT DO NOTHING 未插入且五元预检未命中（不可达）`);
    }
    return { inserted: false, movementId: dup.id, movementNo: dup.movementNo };
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

  return { inserted: true, movementId, movementNo };
}

/**
 * 批量执行多条 Ledger 原子（**在调用方事务内，全有或全无**——任一失败抛错，调用方事务整体回滚；
 * 支持 Transfer SOURCE_OUT + DESTINATION_IN、Conversion CONSUME + PRODUCE 等成组 command）。
 * 不自行 `$transaction`：由调用方把「业务单据终态 + Movement + Projection」包进同一个事务。
 */
export async function executeLedgerAtoms(
  tx: Prisma.TransactionClient,
  atoms: LedgerAtom[],
): Promise<ExecuteLedgerAtomResult[]> {
  const results: ExecuteLedgerAtomResult[] = [];
  for (const atom of atoms) {
    results.push(await executeLedgerAtom(tx, atom));
  }
  return results;
}
