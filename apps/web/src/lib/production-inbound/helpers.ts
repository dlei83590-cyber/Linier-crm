import { Prisma } from "@prisma/client";
import { nextDocumentCode, DocumentSequenceMissingError } from '@/lib/document-sequence/next-code';
import { executeLedgerAtoms, type LedgerAtom } from "@/lib/inventory-ledger/ledger-command";
import { upsertInboundCost } from "@/lib/inventory-cost/moving-average";

/**
 * P-2 生产入库共享逻辑（POSTED 库存效应 + 取号 + 金额计算）
 * - inboundNo：DocumentSequence docType=PRODUCTION_INBOUND 创建即取号（fail closed，禁 fallback）
 * - 金额 canonical：amount = unitCost × toQty；totalQty = ΣtoQty；totalAmount = Σamount（服务端计算，不信任客户端）
 * - POSTED 库存效应（同事务）：半成品 OUT（fromQty，role=CONSUME）+ 产成品 IN（toQty，role=PRODUCE），
 *   同一 movementGroupId（sourceType=PRODUCTION）；产成品成本经 upsertInboundCost 计入移动加权成本层
 *   （sourceKey=COST:PRODUCTION_IN:{lineId} 幂等）；半成品出库成本由 executeLedgerAtom 自动结转（COST_OUT:{movementId}）
 */

export interface ProductionLineInput {
  fromItemId: string;
  fromQty: number | string;
  toItemId: string;
  toQty: number | string;
  unitCost: number | string;
  remark?: string | null;
}

/** 生产入库单号取号（原子 increment；DocumentSequence 缺失 = 配置错误抛错；单据序列重构：PIN-LNE{YYYY}{MM}{####}） */
export async function nextInboundNo(tx: Prisma.TransactionClient, documentDate: Date): Promise<string> {
  try {
    return await nextDocumentCode(tx, "PRODUCTION_INBOUND", documentDate);
  } catch (err) {
    if (err instanceof DocumentSequenceMissingError) throw new Error("PRODUCTION_INBOUND_SEQUENCE_MISSING");
    throw err;
  }
}

/** 行金额 canonical 计算（服务端）：amount = unitCost × toQty（14,2） */
export function computeLineAmount(unitCost: Prisma.Decimal, toQty: Prisma.Decimal): Prisma.Decimal {
  return unitCost.mul(toQty).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export interface PostAtomsInput {
  inboundId: string;
  inboundNo: string;
  warehouseId: string;
  batchNo: string | null;
  actorId: string;
  occurredAt: string;
  lines: Array<{
    id: string;
    fromItemId: string;
    fromQty: Prisma.Decimal;
    toItemId: string;
    toQty: Prisma.Decimal;
    amount: Prisma.Decimal;
  }>;
}

/** 构造 POSTED 库存原子组（每行 2 atoms：半成品 OUT + 产成品 IN；同一 movementGroupId） */
export function buildPostAtoms(input: PostAtomsInput): LedgerAtom[] {
  const groupId = "PROD:" + input.inboundId;
  const atoms: LedgerAtom[] = [];
  for (const line of input.lines) {
    atoms.push({
      sourceType: "PRODUCTION",
      sourceId: input.inboundId,
      sourceLineId: line.id,
      movementRole: "CONSUME",
      movementAtomKey: "CONSUME",
      movementGroupId: groupId,
      direction: "OUT",
      movementType: "CONSUME",
      warehouseId: input.warehouseId,
      locationId: null,
      itemId: line.fromItemId,
      batchNo: input.batchNo,
      serialNo: null,
      quantity: line.fromQty,
      uomId: null,
      mfgDate: null,
      expDate: null,
      referenceNo: input.inboundNo,
      actorId: input.actorId,
      occurredAt: input.occurredAt,
      remark: "生产入库消耗（半成品）",
    });
    atoms.push({
      sourceType: "PRODUCTION",
      sourceId: input.inboundId,
      sourceLineId: line.id,
      movementRole: "PRODUCE",
      movementAtomKey: "PRODUCE",
      movementGroupId: groupId,
      direction: "IN",
      movementType: "PRODUCE",
      warehouseId: input.warehouseId,
      locationId: null,
      itemId: line.toItemId,
      batchNo: input.batchNo,
      serialNo: null,
      quantity: line.toQty,
      uomId: null,
      mfgDate: null,
      expDate: null,
      referenceNo: input.inboundNo,
      actorId: input.actorId,
      occurredAt: input.occurredAt,
      remark: "生产入库（产成品）",
    });
  }
  return atoms;
}

/**
 * POSTED 库存效应（调用方事务内）：
 * 1. executeLedgerAtoms：半成品 OUT + 产成品 IN（Movement + StockProjection + 出库成本结转）
 * 2. upsertInboundCost：产成品入库成本计入移动加权成本层（幂等 sourceKey）
 * 任一失败 → 调用方事务整体回滚（全有或全无）
 */
export async function applyPostInventoryEffect(
  tx: Prisma.TransactionClient,
  input: PostAtomsInput,
): Promise<void> {
  const atoms = buildPostAtoms(input);
  await executeLedgerAtoms(tx, atoms);
  for (const line of input.lines) {
    const result = await upsertInboundCost(tx, {
      itemId: line.toItemId,
      quantity: line.toQty,
      baseAmount: line.amount,
      sourceKey: "COST:PRODUCTION_IN:" + line.id,
      actorId: input.actorId,
    });
    if (!result.ok) throw new Error("COST_IN_FAILED:" + result.code);
  }
}
