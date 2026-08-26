import { Prisma } from '@prisma/client';
import { nextDocumentCode, DocumentSequenceMissingError } from '@/lib/document-sequence/next-code';
import type { LedgerAtom } from '@/lib/inventory-ledger/ledger-command';

/**
 * Sprint 6B-3 - Inventory Adjustment 领域通用函数（**不放路由逻辑**；对齐 6B-2 Transfer helpers 模式）
 * 设计依据：Sprint6B_Inventory_Operations_Architecture_Process_Gate.md §5（Adjustment = 受控库存账事实）+
 *           Field Matrix v0.5 §3 + ADR-0026 + P8/P9 Final + CTO 6B-3 授权
 * - adjustmentNo DocumentSequence **创建即取号**（ADJ；docType=INVENTORY_ADJUSTMENT 已由 6B Seed，幂等 upsert）
 * - **红线：Adjustment 只能经 Shared LedgerCommand 追加 ADJUSTMENT Movement**（同步命令）；绝不直写 Projection
 * - 每行 → 一笔 ADJUSTMENT Movement（direction 行级 IN/OUT，quantity 恒正数，方向承载正负语义）
 * - maker-checker（P9 Final）：createdById（创建人）与 approvedById/appliedById（批准/Apply 人）不得相同（service 强制 + DB CHECK 兜底）
 * - reasonCode（P8 Final）：系统保留码（COUNT_VARIANCE/DAMAGE/LOSS/GIFT/SYSTEM_CORRECTION/MANUAL）+ 可扩展字典（String，不写死 enum）
 * - Minor Hardening ②：非空 sourceStockCountLineId 必须属于 sourceStockCountId 指向的盘点单（service Gate 事务内校验）
 * - serial-managed：serialNo 单值逐 serial 原子化（movementAtomKey=serialNo，quantity=1）；非 serial → BULK
 */

/**
 * DocumentSequence 缺失 = **部署配置错误**（CTO Transfer Review Blocking ① 同款治理，6B-3 沿用）。
 * Sequence 是 deployment prerequisite：缺失时**禁止生成临时编号**（fallback 会导致首次/第二次 Adjustment
 * 都拿到 ADJ000001 → UNIQUE 冲突/不稳定 500，并掩盖真实部署配置错误）。缺失必须 fail closed。
 */
export class InventoryAdjustmentSequenceMissingError extends Error {
  constructor() {
    super('INVENTORY_ADJUSTMENT DocumentSequence 缺失（docType=INVENTORY_ADJUSTMENT）——部署配置错误，请先执行 seed 初始化');
    this.name = 'InventoryAdjustmentSequenceMissingError';
  }
}

/** DocumentSequence 原子取号（docType=INVENTORY_ADJUSTMENT，前缀 ADJ；创建即取号；Sequence 缺失 fail closed；单据序列重构：ADJ-LNE{YYYY}{MM}{####}） */
export async function nextAdjustmentNo(tx: Prisma.TransactionClient, documentDate: Date): Promise<string> {
  try {
    return await nextDocumentCode(tx, 'INVENTORY_ADJUSTMENT', documentDate);
  } catch (err) {
    if (err instanceof DocumentSequenceMissingError) throw new InventoryAdjustmentSequenceMissingError();
    throw err;
  }
}

/** 调整行去重键（同一调整单内五维组合只能出现一次，防重复调整同一库存维度） */
export function adjustmentLineDedupeKey(line: {
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
 * 构造 Adjustment → ADJUSTMENT atom（**每行一笔 Movement**；Apply 时同事务执行）。
 * - 五元幂等：sourceType=ADJUSTMENT，sourceId=adjustment.id，sourceLineId=line.id，
 *   movementRole=ADJUSTMENT，movementAtomKey=BULK（非 serial）或 serialNo（serial-managed 逐 serial）
 * - movementGroupId=adjustment.id（**稳定业务事实**——同一次 Adjustment 全部行共享；重试复用，不随机重造）
 * - direction=行 direction（IN/OUT），movementType=ADJUSTMENT；quantity 恒正数（方向承载正负语义）
 * - batchNo 继承（AdjustmentLine 已 capture）；mfgDate/expDate 为 null（Adjustment 无此字段）
 * - 金额/数量始终 `Prisma.Decimal`，**禁止 number 中间转换**（CTO 红线）
 */
export function buildAdjustmentAtoms(params: {
  adjustment: { id: string; adjustmentNo: string };
  lines: Pick<
    {
      id: string;
      warehouseId: string;
      locationId: string | null;
      itemId: string;
      batchNo: string | null;
      serialNo: string | null;
      direction: 'IN' | 'OUT';
      quantity: Prisma.Decimal;
      uomId: string | null;
    },
    'id' | 'warehouseId' | 'locationId' | 'itemId' | 'batchNo' | 'serialNo' | 'direction' | 'quantity' | 'uomId'
  >[];
  actorId: string | null;
  occurredAt: string;
}): LedgerAtom[] {
  const { adjustment, lines, actorId, occurredAt } = params;
  return lines.map((line) => ({
    sourceType: 'ADJUSTMENT',
    sourceId: adjustment.id,
    sourceLineId: line.id,
    movementRole: 'ADJUSTMENT',
    movementAtomKey: line.serialNo ?? 'BULK',
    movementGroupId: adjustment.id, // 稳定业务事实（同单共享；重试复用）
    direction: line.direction,
    movementType: 'ADJUSTMENT',
    warehouseId: line.warehouseId,
    locationId: line.locationId,
    itemId: line.itemId,
    batchNo: line.batchNo,
    serialNo: line.serialNo,
    quantity: line.quantity, // 恒正数（方向在行）
    uomId: line.uomId ?? null,
    mfgDate: null,
    expDate: null,
    referenceNo: adjustment.adjustmentNo,
    actorId,
    occurredAt,
    remark: `Adjustment ${adjustment.adjustmentNo}`,
  }));
}
