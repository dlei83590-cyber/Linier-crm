import { Prisma } from '@prisma/client';

/**
 * P-1 Item Sourcing — 配方（ItemBom）领域函数（不放路由逻辑）
 *
 * - bomNo 自动生成（非 DocumentSequence）：BOM-{成品code}-{bomVersion}
 * - 原料需求量 = 成品数量 × qtyPerFinishedUnit × (1 + lossRate)（吨→米/件/个在配方系数表达）
 * - 红线：componentUomId 必须 = 原料库存单位（stockUomId，服务端校验，禁前端任意 UOM）
 */

/** 原料需求量 canonical 计算（服务端）：成品数 × 系数 × (1 + 损耗率)，ROUND_HALF_UP 4 */
export function computeMaterialRequirement(
  finishedQty: Prisma.Decimal,
  qtyPerFinishedUnit: Prisma.Decimal,
  lossRate: Prisma.Decimal,
): Prisma.Decimal {
  const factor = qtyPerFinishedUnit.mul(new Prisma.Decimal(1).plus(lossRate));
  return finishedQty.mul(factor).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

/** 配方编码自动生成：BOM-{成品code}-{bomVersion} */
export function buildBomNo(itemCode: string, bomVersion: number): string {
  return `BOM-${itemCode}-${bomVersion}`;
}
