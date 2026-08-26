import { Prisma } from '@prisma/client';
import { nextDocumentCode, DocumentSequenceMissingError } from '@/lib/document-sequence/next-code';

/**
 * Sprint 6B-3 - Stock Count 领域通用函数（**不放路由逻辑**；对齐 6B-2 Transfer helpers 模式）
 * 设计依据：Sprint6B_Inventory_Operations_Architecture_Process_Gate.md §4（Count = 实盘事实 ≠ 库存账事实）+
 *           Field Matrix v0.5 §2 + ADR-0026 + CTO 6B-3 授权
 * - countNo DocumentSequence **创建即取号**（CNT；docType=STOCK_COUNT 已由 6B Seed，幂等 upsert）
 * - **红线：Count 本身不产生 Movement、不更新 StockProjection**——只有 Adjustment Apply 才允许调用 Shared LedgerCommand
 * - per-line atomic snapshot：录入 countedQty 时同事务读取五维 StockProjection → bookQtyAtCount/countedAt/ledgerWatermark
 * - varianceQty = countedQty - bookQtyAtCount（服务端计算；无动态补偿公式——盘点期间正常 Movement 同时改变物理与账面库存）
 * - watermark 仅审计（movementNo 不作并发时序主键，不参与 variance 算法）
 */

/**
 * DocumentSequence 缺失 = **部署配置错误**（CTO Transfer Review Blocking ① 同款治理，6B-3 沿用）。
 * Sequence 是 deployment prerequisite：缺失时**禁止生成临时编号**（fallback 会导致首次/第二次 Count
 * 都拿到 CNT000001 → UNIQUE 冲突/不稳定 500，并掩盖真实部署配置错误）。缺失必须 fail closed。
 */
export class StockCountSequenceMissingError extends Error {
  constructor() {
    super('STOCK_COUNT DocumentSequence 缺失（docType=STOCK_COUNT）——部署配置错误，请先执行 seed 初始化');
    this.name = 'StockCountSequenceMissingError';
  }
}

/** DocumentSequence 原子取号（docType=STOCK_COUNT，前缀 CNT；创建即取号；Sequence 缺失 fail closed；单据序列重构：CNT-LNE{YYYY}{MM}{####}） */
export async function nextCountNo(tx: Prisma.TransactionClient, documentDate: Date): Promise<string> {
  try {
    return await nextDocumentCode(tx, 'STOCK_COUNT', documentDate);
  } catch (err) {
    if (err instanceof DocumentSequenceMissingError) throw new StockCountSequenceMissingError();
    throw err;
  }
}

/** 盘点行去重键（同一盘点单内五维组合只能出现一次，防重复盘同一库存维度） */
export function countLineDedupeKey(line: {
  warehouseId: string;
  locationId: string | null;
  itemId: string;
  batchNo: string | null;
  serialNo: string | null;
}): string {
  return [
    line.warehouseId,
    line.locationId ?? '\u0000',
    line.itemId,
    line.batchNo ?? '\u0000',
    line.serialNo ?? '\u0000',
  ].join('|');
}

/**
 * 读取五维 StockProjection 快照（per-line atomic snapshot——CTO #7975 Blocking ①）。
 * - 同事务 findFirst 按五维读取（Projection 五维 NULLS NOT DISTINCT 唯一；不存在 = 该维度无库存记录 → onHandQty=0）
 * - **只读快照**：不 FOR UPDATE、不创建——Count 不锁库存、不冻结业务（DYNAMIC 策略），差异公式不依赖锁
 * - ledgerWatermark 仅审计/重放证据（记录 projection.lastMovementAt，不参与 variance 算法）
 */
export async function readProjectionSnapshot(
  tx: Prisma.TransactionClient,
  dims: { warehouseId: string; locationId: string | null; itemId: string; batchNo: string | null; serialNo: string | null },
): Promise<{ bookQtyAtCount: Prisma.Decimal; ledgerWatermark: string | null }> {
  const projection = await tx.stockProjection.findFirst({
    where: {
      warehouseId: dims.warehouseId,
      locationId: dims.locationId,
      itemId: dims.itemId,
      batchNo: dims.batchNo,
      serialNo: dims.serialNo,
    },
    select: { onHandQty: true, lastMovementAt: true },
  });
  return {
    bookQtyAtCount: projection?.onHandQty ?? new Prisma.Decimal(0),
    ledgerWatermark: projection?.lastMovementAt?.toISOString() ?? null,
  };
}

/** 由 StockCountLine 计算 varianceQty（countedQty - bookQtyAtCount；服务端计算，禁用动态补偿公式） */
export function computeVarianceQty(countedQty: Prisma.Decimal, bookQtyAtCount: Prisma.Decimal): Prisma.Decimal {
  return countedQty.minus(bookQtyAtCount);
}
