import { Prisma } from '@prisma/client';
import { nextDocumentCode, DocumentSequenceMissingError } from '@/lib/document-sequence/next-code';
import type { LedgerAtom } from '@/lib/inventory-ledger/ledger-command';
import { computeMaterialRequirement } from '@/lib/item-bom/helpers';

/** 物料行输入（手动模式） */
export interface MaterialLineInput {
  itemId: string;
  quantity: number | string;
  uomId?: string | null;
  warehouseId?: string | null;
}

/** 解析后的物料行（服务端 canonical） */
export interface ResolvedMaterialLine {
  itemId: string;
  uomId: string;
  quantity: Prisma.Decimal;
  warehouseId: string;
}

/**
 * 物料行解析（创建/编辑/过账共用）：
 * - 有 bomId（ACTIVE 且属于本成品）→ 服务端按配方计算需求量（成品数 × 系数 × (1+损耗率)），领料仓库 = materialWarehouseId
 * - 无 bomId（手工工单）→ 客户端提供物料行，校验 item 存在 + 行单位 = 物料库存单位（红线）+ 仓库存在
 * 校验失败抛 Error（message = 错误码字符串，路由层映射）
 */
export async function resolveMaterialLines(
  tx: Prisma.TransactionClient,
  params: {
    bomId: string | null;
    finishedItemId: string;
    plannedQty: Prisma.Decimal;
    materialWarehouseId: string | null;
    manualLines: MaterialLineInput[];
  },
): Promise<ResolvedMaterialLine[]> {
  if (params.bomId) {
    const bom = await tx.itemBom.findFirst({
      where: { id: params.bomId, status: 'ACTIVE', deletedAt: null },
      include: { lines: { where: { deletedAt: null } } },
    });
    if (!bom) throw new Error('BOM_INVALID');
    if (bom.finishedItemId !== params.finishedItemId) throw new Error('BOM_INVALID');
    if (!params.materialWarehouseId) throw new Error('WAREHOUSE_INVALID');
    const wh = await tx.warehouse.findFirst({ where: { id: params.materialWarehouseId, deletedAt: null } });
    if (!wh) throw new Error('WAREHOUSE_INVALID');
    return bom.lines.map((l) => ({
      itemId: l.componentItemId,
      uomId: l.componentUomId,
      quantity: computeMaterialRequirement(params.plannedQty, l.qtyPerFinishedUnit, l.lossRate),
      warehouseId: params.materialWarehouseId as string,
    }));
  }
  const rows: ResolvedMaterialLine[] = [];
  for (const m of params.manualLines) {
    const item = await tx.item.findFirst({ where: { id: m.itemId, deletedAt: null } });
    if (!item || !item.stockUomId) throw new Error('ITEM_INVALID');
    const uomId = m.uomId ?? item.stockUomId;
    if (uomId !== item.stockUomId) throw new Error('UOM_INVALID');
    if (!m.warehouseId) throw new Error('WAREHOUSE_INVALID');
    const wh = await tx.warehouse.findFirst({ where: { id: m.warehouseId, deletedAt: null } });
    if (!wh) throw new Error('WAREHOUSE_INVALID');
    const quantity = new Prisma.Decimal(m.quantity);
    if (quantity.lte(0)) throw new Error('LINE_INVALID');
    rows.push({ itemId: m.itemId, uomId, quantity, warehouseId: m.warehouseId });
  }
  if (rows.length === 0) throw new Error('NO_LINES');
  return rows;
}

/**
 * P-1 Item Sourcing — 生产/外协工单（ProductionOrder）领域函数（不放路由逻辑）
 *
 * - orderNo：DocumentSequence docType=PRODUCTION_ORDER 创建即取号（fail closed，禁 fallback）
 * - POSTED 库存效应（同事务）：原料行逐行 OUT（role=CONSUME）+ 成品行 IN（role=PRODUCE），
 *   同一稳定 movementGroupId（sourceType=PRODUCTION，与 ProductionInbound 同源——movement 以 referenceNo=orderNo 区分）
 * - 成品成本 = Σ原料出库成本 + OEM 加工费（服务端计算；原料出库成本由 executeLedgerAtom 自动结转）
 */

export class ProductionOrderSequenceMissingError extends Error {
  constructor() {
    super('PRODUCTION_ORDER DocumentSequence 缺失（docType=PRODUCTION_ORDER）——部署配置错误，请先执行 seed 初始化');
    this.name = 'ProductionOrderSequenceMissingError';
  }
}

/** DocumentSequence 原子取号（docType=PRODUCTION_ORDER，前缀 PRD；创建即取号；Sequence 缺失 fail closed；单据序列重构：PRD-LNE{YYYY}{MM}{####}） */
export async function nextOrderNo(tx: Prisma.TransactionClient, documentDate: Date): Promise<string> {
  try {
    return await nextDocumentCode(tx, 'PRODUCTION_ORDER', documentDate);
  } catch (err) {
    if (err instanceof DocumentSequenceMissingError) throw new ProductionOrderSequenceMissingError();
    throw err;
  }
}

/** 配方需求量（单个成品 × 配方行系数 × 损耗率）——供 POST/校验复用 */
export function bomRequirementForLine(
  finishedQty: Prisma.Decimal,
  qtyPerFinishedUnit: Prisma.Decimal,
  lossRate: Prisma.Decimal,
): Prisma.Decimal {
  return computeMaterialRequirement(finishedQty, qtyPerFinishedUnit, lossRate);
}

export interface ProductionAtomInput {
  orderId: string;
  orderNo: string;
  productionType: string;
  movementGroupId: string;
  batchNo: string | null;
  actorId: string | null;
  occurredAt: string;
  finishedWarehouseId: string;
  materialLines: Array<{
    id: string;
    itemId: string;
    uomId: string | null;
    quantity: Prisma.Decimal;
    warehouseId: string;
    remark?: string | null;
  }>;
  finishedLine: {
    id: string;
    itemId: string;
    uomId: string | null;
    quantity: Prisma.Decimal;
    remark?: string | null;
  };
}

/** 构造 POSTED 库存原子组：原料行 OUT（CONSUME）+ 成品 IN（PRODUCE）；同一稳定 movementGroupId */
export function buildProductionAtoms(input: ProductionAtomInput): LedgerAtom[] {
  const atoms: LedgerAtom[] = [];
  for (const m of input.materialLines) {
    atoms.push({
      sourceType: 'PRODUCTION',
      sourceId: input.orderId,
      sourceLineId: m.id,
      movementRole: 'CONSUME',
      movementAtomKey: 'BULK',
      movementGroupId: input.movementGroupId,
      direction: 'OUT',
      movementType: 'CONSUME',
      warehouseId: m.warehouseId,
      locationId: null,
      itemId: m.itemId,
      batchNo: input.batchNo,
      serialNo: null,
      quantity: m.quantity,
      uomId: m.uomId,
      mfgDate: null,
      expDate: null,
      referenceNo: input.orderNo,
      actorId: input.actorId,
      occurredAt: input.occurredAt,
      remark: m.remark ?? `生产领料（${input.orderNo}）`,
    });
  }
  atoms.push({
    sourceType: 'PRODUCTION',
    sourceId: input.orderId,
    sourceLineId: input.finishedLine.id,
    movementRole: 'PRODUCE',
    movementAtomKey: 'BULK',
    movementGroupId: input.movementGroupId,
    direction: 'IN',
    movementType: 'PRODUCE',
    warehouseId: input.finishedWarehouseId,
    locationId: null,
    itemId: input.finishedLine.itemId,
    batchNo: input.batchNo,
    serialNo: null,
    quantity: input.finishedLine.quantity,
    uomId: input.finishedLine.uomId,
    mfgDate: null,
    expDate: null,
    referenceNo: input.orderNo,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    remark: input.finishedLine.remark ?? `生产入库（${input.orderNo}）`,
  });
  return atoms;
}

/**
 * 原料出库成本预计算（与 applyOutboundCost 同口径：min(qty × avg, totalCost)；无成本层/avg<=0 → 0）
 * 与 executeLedgerAtom 内部 applyOutboundCost 在**同一事务 + 同五维投影锁**下执行 → 结果一致（确定性）
 */
export async function computeMaterialIssueCost(
  tx: Prisma.TransactionClient,
  itemId: string,
  quantity: Prisma.Decimal,
): Promise<Prisma.Decimal> {
  const balance = await tx.inventoryCostBalance.findFirst({ where: { itemId } });
  if (!balance || balance.avgUnitCost.lte(0)) {
    return new Prisma.Decimal(0);
  }
  const grossCost = quantity.mul(balance.avgUnitCost);
  return Prisma.Decimal.min(grossCost, balance.totalCost);
}
