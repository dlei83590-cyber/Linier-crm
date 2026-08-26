import { Prisma } from '@prisma/client';
import { nextDocumentCode, DocumentSequenceMissingError } from '@/lib/document-sequence/next-code';
import type { InventoryTransfer, InventoryTransferLine } from '@prisma/client';
import type { LedgerAtom } from '@/lib/inventory-ledger/ledger-command';

/**
 * Sprint 6B-2 - Inventory Transfer 领域通用函数（**不放路由逻辑**；对齐 5B warehouse-receipt helpers 模式）
 * 设计依据：Sprint6B_Inventory_Operations_Architecture_Process_Gate.md §3（Transfer 双边原子事实）+
 *           Field Matrix v0.5 §1 + ADR-0026 D2（Transfer = 双边原子事实 SOURCE_OUT + DESTINATION_IN）+ CTO 6B-2 授权
 * - code DocumentSequence **创建即取号**（TRF；docType=INVENTORY_TRANSFER 已由 6B Schema seed，幂等 upsert）
 * - **Execute 三个不可妥协不变量（CTO 6B-2 锁死）**：
 *   ① SOURCE_OUT + DESTINATION_IN 共用同一非空 movementGroupId；
 *   ② 业务单据 EXECUTED + 两笔 Movement + 两侧 Projection 必须在**同一个 caller transaction** 内全有或全无；
 *   ③ 任何重试必须通过 Shared Core 的 identity+immutable-fact 幂等规则，**禁止 Transfer 自己再实现一套库存扣增逻辑**。
 * - 五元幂等：sourceType=TRANSFER，sourceId=transfer.id，sourceLineId=line.id，
 *   movementRole=SOURCE_OUT/DESTINATION_IN，movementAtomKey=BULK 或 serialNo（serial-managed 每 serial 一对）
 * - 金额始终 `Prisma.Decimal`，**禁止 number 中间转换**（CTO 红线：Decimal 无 Float/Number 转换）。
 */

/**
 * DocumentSequence 缺失 = **部署配置错误**（CTO Transfer Review Blocking ① 修复）。
 * Sequence 是 deployment prerequisite，不是可静默降级的 optional configuration：
 * 缺失时**禁止生成临时编号**（fallback 会导致首次/第二次 Transfer 都拿到 TRF000001 →
 * UNIQUE 冲突/不稳定 500，并把真正的部署配置错误伪装成业务运行正常——与 6A Movement
 * 已修问题完全同类）。缺失必须 fail closed：抛稳定配置错误，由 Create API 显式映射。
 */
export class InventoryTransferSequenceMissingError extends Error {
  constructor() {
    super('INVENTORY_TRANSFER DocumentSequence 缺失（docType=INVENTORY_TRANSFER）——部署配置错误，请先执行 seed 初始化');
    this.name = 'InventoryTransferSequenceMissingError';
  }
}

/** DocumentSequence 原子取号（docType=INVENTORY_TRANSFER，前缀 TRF；创建即取号；Sequence 缺失 fail closed；单据序列重构：TRF-LNE{YYYY}{MM}{####}） */
export async function nextTransferNo(tx: Prisma.TransactionClient, documentDate: Date): Promise<string> {
  try {
    return await nextDocumentCode(tx, 'INVENTORY_TRANSFER', documentDate);
  } catch (err) {
    if (err instanceof DocumentSequenceMissingError) throw new InventoryTransferSequenceMissingError();
    throw err;
  }
}

/**
 * 构造 Transfer 双 atom（SOURCE_OUT + DESTINATION_IN，**同一 movementGroupId**；serial-managed 每 serial 一对）。
 * - 非 serial：一对 BULK（movementAtomKey='BULK'，quantity=line.quantity）；
 * - serial-managed：每 serial 一对（SOURCE_OUT serialNo=X + DESTINATION_IN serialNo=X，quantity=1，movementAtomKey=serialNo）；
 *   守恒校验：quantity 必须 = serialNos.length 且整数（对齐 5B expandSourceLineAtoms 规则）；
 * - batch 精确继承（P5 Final：SOURCE_OUT batch=B → DESTINATION_IN batch=B；首版不拆批不换批）；
 * - mfgDate/expDate 继承来源（TransferLine 已 capture）；
 * - 返回的 atoms 由调用方在**同一 caller transaction** 内传给 executeLedgerAtoms（全有或全无）。
 */
export function buildTransferAtoms(params: {
  transfer: Pick<
    InventoryTransfer,
    'id' | 'transferNo' | 'sourceWarehouseId' | 'sourceLocationId' | 'destinationWarehouseId' | 'destinationLocationId'
  >;
  lines: Pick<
    InventoryTransferLine,
    'id' | 'itemId' | 'uomId' | 'quantity' | 'batchNo' | 'serialNos' | 'mfgDate' | 'expDate'
  >[];
  movementGroupId: string; // EXECUTE 时生成并冻结（同一非空 group id，双边共享）
  actorId: string | null;
  occurredAt: string;
}): LedgerAtom[] {
  const { transfer, lines, movementGroupId, actorId, occurredAt } = params;
  const atoms: LedgerAtom[] = [];

  for (const line of lines) {
    const base = {
      sourceType: 'TRANSFER' as const,
      sourceId: transfer.id,
      sourceLineId: line.id,
      movementGroupId,
      warehouseId: transfer.sourceWarehouseId,
      locationId: transfer.sourceLocationId,
      itemId: line.itemId,
      batchNo: line.batchNo ?? null,
      uomId: line.uomId,
      mfgDate: line.mfgDate,
      expDate: line.expDate,
      referenceNo: transfer.transferNo,
      actorId,
      occurredAt,
      remark: `Transfer ${transfer.transferNo}`,
    };

    if (line.serialNos.length > 0) {
      // serial-managed（P5 Final：每 serial 一对，serial 精确继承不重生成）
      if (!line.quantity.isInteger()) {
        throw new Error(`serial-managed 数量必须是整数（当前 ${line.quantity}）`);
      }
      if (!line.quantity.equals(new Prisma.Decimal(line.serialNos.length))) {
        throw new Error(`序列号数量不守恒：serialNos(${line.serialNos.length}) != quantity(${line.quantity})`);
      }
      if (new Set(line.serialNos).size !== line.serialNos.length) {
        throw new Error('序列号列表内存在重复 serial（每个 serial 必须是唯一原子）');
      }
      for (const serialNo of line.serialNos) {
        atoms.push({
          ...base,
          movementRole: 'SOURCE_OUT',
          movementAtomKey: serialNo,
          direction: 'OUT',
          movementType: 'TRANSFER_OUT',
          serialNo,
          quantity: new Prisma.Decimal(1),
        });
        atoms.push({
          ...base,
          movementRole: 'DESTINATION_IN',
          movementAtomKey: serialNo,
          direction: 'IN',
          movementType: 'TRANSFER_IN',
          warehouseId: transfer.destinationWarehouseId,
          locationId: transfer.destinationLocationId,
          serialNo,
          quantity: new Prisma.Decimal(1),
        });
      }
    } else {
      // 非 serial：一对 BULK（双边 quantity 相等——守恒）
      atoms.push({
        ...base,
        movementRole: 'SOURCE_OUT',
        movementAtomKey: 'BULK',
        direction: 'OUT',
        movementType: 'TRANSFER_OUT',
        serialNo: null,
        quantity: line.quantity,
      });
      atoms.push({
        ...base,
        movementRole: 'DESTINATION_IN',
        movementAtomKey: 'BULK',
        direction: 'IN',
        movementType: 'TRANSFER_IN',
        warehouseId: transfer.destinationWarehouseId,
        locationId: transfer.destinationLocationId,
        serialNo: null,
        quantity: line.quantity,
      });
    }
  }

  return atoms;
}

/** 行级去重键（同一调拨单内 itemId+batchNo+serialNos 组合只能出现一次，防重复调拨同一维度） */
export function transferLineDedupeKey(line: {
  itemId: string;
  batchNo: string | null;
  serialNos: string[];
}): string {
  return [line.itemId, line.batchNo ?? '\u0000', [...line.serialNos].sort().join(',')].join('|');
}
