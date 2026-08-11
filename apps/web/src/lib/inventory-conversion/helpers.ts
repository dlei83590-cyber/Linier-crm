import { Prisma } from '@prisma/client';
import type { LedgerAtom } from '@/lib/inventory-ledger/ledger-command';

/**
 * Sprint 6B-4 - Inventory Conversion 领域通用函数（**不放路由逻辑**；对齐 6B-2/6B-3 helpers 模式）
 * 设计依据：Sprint6B_Inventory_Operations_Architecture_Process_Gate.md §6 + Field Matrix v0.5 §4 +
 *           ADR-0026 + P10/P11 Final + CTO #8658 授权
 * - conversionNo DocumentSequence **创建即取号**（CVT；docType=INVENTORY_CONVERSION 已由 6B Seed，幂等 upsert）
 * - **首版边界（CTO 锁死）**：同一 itemId Repack / UOM Conversion；一张 Conversion 最多 1 CONSUME + 1 PRODUCE；
 *   禁止 BOM/组装/拆解/多物料；batch 默认精确继承；serial 不允许重新生成
 * - **baseQuantity 必须由服务端 canonical 计算**（baseQuantity = quantity × uomToBaseRate，Decimal 精度规则统一）——
 *   **不能信任客户端提交的 baseQuantity**（CTO 锁死①）；schema 不收 baseQuantity，服务端 computeBaseQuantity
 * - **守恒（CTO 锁死②）**：CONSUME.baseQuantity == PRODUCE.baseQuantity 才允许 Execute（P11 Final）
 * - Execute：CONSUME + PRODUCE 同一稳定 movementGroupId，经 Shared executeLedgerAtoms 同事务原子提交
 */

/**
 * DocumentSequence 缺失 = **部署配置错误**（CTO Transfer/Count Review Blocking ① 同款治理，6B-4 沿用）。
 * Sequence 是 deployment prerequisite：缺失时**禁止生成临时编号**（fallback 会导致首次/第二次 Conversion
 * 都拿到 CVT000001 → UNIQUE 冲突/不稳定 500，并掩盖真实部署配置错误）。缺失必须 fail closed。
 */
export class InventoryConversionSequenceMissingError extends Error {
  constructor() {
    super('INVENTORY_CONVERSION DocumentSequence 缺失（docType=INVENTORY_CONVERSION）——部署配置错误，请先执行 seed 初始化');
    this.name = 'InventoryConversionSequenceMissingError';
  }
}

/** DocumentSequence 原子取号（docType=INVENTORY_CONVERSION，前缀 CVT，位数 6；创建即取号；Sequence 缺失 fail closed） */
export async function nextConversionNo(tx: Prisma.TransactionClient): Promise<string> {
  const seq = await tx.documentSequence.findFirst({
    where: { docType: 'INVENTORY_CONVERSION', isActive: true, deletedAt: null },
  });
  if (!seq) {
    throw new InventoryConversionSequenceMissingError();
  }
  const updated = await tx.documentSequence.update({
    where: { id: seq.id },
    data: { nextNo: { increment: 1 } },
  });
  return `${seq.prefix}${String(updated.nextNo - 1).padStart(seq.padLength, '0')}`;
}

/**
 * **服务端 canonical 计算 baseQuantity**（CTO 锁死①：不信任客户端提交的 baseQuantity）。
 * baseQuantity = quantity × uomToBaseRate（Decimal 精度规则统一：quantity Decimal(18,4) × rate Decimal(18,6)
 * → 结果 toDecimalPlaces(4) 落库字段 Decimal(18,4)，**禁止 number 中间转换**——CTO 红线）。
 * DB 不强算（Minor Hardening ①：Decimal 精度/舍入由 service 统一控制）。
 */
export function computeBaseQuantity(quantity: Prisma.Decimal, uomToBaseRate: Prisma.Decimal): Prisma.Decimal {
  return quantity.mul(uomToBaseRate).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

/** 转换行去重键（同一转换单内 lineRole 只能出现一次——UNIQUE(conversionHeaderId, lineRole) 兜底） */
export function conversionLineDedupeKey(line: { lineRole: 'CONSUME' | 'PRODUCE' }): string {
  return line.lineRole;
}

/**
 * 构造 Conversion 双 atom（**CONSUME + PRODUCE，同一非空 movementGroupId**；Execute 时同事务执行）。
 * - 五元幂等：sourceType=CONVERSION，sourceId=conversion.id，sourceLineId=line.id，
 *   movementRole=CONSUME/PRODUCE，movementAtomKey=BULK（首版不支持 serial）
 * - movementGroupId=conversion.movementGroupId（**稳定业务事实**——EXECUTE 时生成/复用并冻结，重试复用，不随机重造）
 * - direction：CONSUME=OUT（消耗）、PRODUCE=IN（产出）；movementType=CONSUME/PRODUCE
 * - **quantity=baseQuantity（canonical）、uomId=conversion.baseUomId**——Ledger 只记 canonical 数量（P11 Final）
 * - batchNo 精确继承（CONSUME batch → PRODUCE batch 同值，首版不拆批不换批）；serialNo=null（serial 不生成）
 * - mfgDate/expDate=null（Conversion 无此字段）
 */
export function buildConversionAtoms(params: {
  conversion: { id: string; conversionNo: string; itemId: string; baseUomId: string; movementGroupId: string };
  consumeLine: {
    id: string;
    warehouseId: string;
    locationId: string | null;
    batchNo: string | null;
    baseQuantity: Prisma.Decimal;
  };
  produceLine: {
    id: string;
    warehouseId: string;
    locationId: string | null;
    batchNo: string | null;
    baseQuantity: Prisma.Decimal;
  };
  actorId: string | null;
  occurredAt: string;
}): LedgerAtom[] {
  const { conversion, consumeLine, produceLine, actorId, occurredAt } = params;
  return [
    {
      sourceType: 'CONVERSION',
      sourceId: conversion.id,
      sourceLineId: consumeLine.id,
      movementRole: 'CONSUME',
      movementAtomKey: 'BULK',
      movementGroupId: conversion.movementGroupId, // 稳定业务事实（CONSUME+PRODUCE 共享；重试复用）
      direction: 'OUT',
      movementType: 'CONSUME',
      warehouseId: consumeLine.warehouseId,
      locationId: consumeLine.locationId,
      itemId: conversion.itemId, // 同一 itemId（首版 Repack/UOM Conversion）
      batchNo: consumeLine.batchNo,
      serialNo: null,
      quantity: consumeLine.baseQuantity, // canonical 数量
      uomId: conversion.baseUomId,
      mfgDate: null,
      expDate: null,
      referenceNo: conversion.conversionNo,
      actorId,
      occurredAt,
      remark: `Conversion ${conversion.conversionNo} CONSUME`,
    },
    {
      sourceType: 'CONVERSION',
      sourceId: conversion.id,
      sourceLineId: produceLine.id,
      movementRole: 'PRODUCE',
      movementAtomKey: 'BULK',
      movementGroupId: conversion.movementGroupId, // 稳定业务事实（CONSUME+PRODUCE 共享；重试复用）
      direction: 'IN',
      movementType: 'PRODUCE',
      warehouseId: produceLine.warehouseId,
      locationId: produceLine.locationId,
      itemId: conversion.itemId, // 同一 itemId（首版 Repack/UOM Conversion）
      batchNo: produceLine.batchNo,
      serialNo: null,
      quantity: produceLine.baseQuantity, // canonical 数量
      uomId: conversion.baseUomId,
      mfgDate: null,
      expDate: null,
      referenceNo: conversion.conversionNo,
      actorId,
      occurredAt,
      remark: `Conversion ${conversion.conversionNo} PRODUCE`,
    },
  ];
}
