import { Prisma } from '@prisma/client';

/**
 * Sprint 5C-1C0 - GRIR Producer Foundation（CTO #9477 Accounting Readiness Hardening）
 * 设计依据：Sprint5C_Supplier_Invoice_Three_Way_Match_AP_Gate.md §4.2/4.3 + Migration 0027
 *           GrirRecord（source_shape_check + 三类 partial UNIQUE 幂等防线）+ CTO #9477 锁定：
 * - **C0-B：WHR POST → GRIR ACCRUAL producer**——与 WarehouseReceipt POSTED + Inventory Outbox IN
 *   同一事务（全有或全无）；每 WHR Line 一条 ACCRUAL；金额口径锁死：
 *   quantity = WHR Line.quantity；unitPrice = PO Line.unitPrice 快照；taxRate = PO Line.taxRate 快照；
 *   baseAmount = quantity × unitPrice（**未税暂估净额，不得确认 Input VAT**——P9 Final）；
 *   溯源链路：WarehouseReceiptLine → PurchaseReceiptLine → PurchaseOrderLine（关系 Schema 已存在）；
 *   幂等：DB partial UNIQUE（warehouseReceiptLineId WHERE grirType='ACCRUAL'）+ sourceKey UNIQUE 兜底。
 * - **C0-C：WHR-based PurchaseReturn RETURN → GRIR REVERSAL producer**——与 PurchaseReturn RETURNED
 *   同一事务；**只对 sourceRefType = WAREHOUSE_RECEIPT_LINE 产生 reversal**（RECEIPT_LINE/INSPECTION
 *   从未形成已入库暂估事实 → 0 GRIR）；幂等：DB partial UNIQUE（purchaseReturnLineId WHERE grirType='REVERSAL'）。
 * - **财务边界（CTO #9477 锁定）**：GRIR Reversal 只能冲减**尚未被 Supplier Invoice consume 的 GRIR**
 *   （remaining unconsumed）；`reversibleQty = min(returnQty, remainingUnconsumedGrirQty)`；仅 > 0 创建
 *   REVERSAL；**不得制造负 GRIR**；退货超过 remaining 的部分 = 已形成 AP 后的供应商贷/借项调整问题 →
 *   进入 5C-2 Supplier CN/DN（本轮**不实现 CN/DN**），但 PurchaseReturn 业务仍成功（不能因 Finance
 *   未实现阻塞物理退货）；超过部分以 remark + Audit 标志留痕（"AP correction pending / requires
 *   Supplier CN-DN"），QA/ADR implementation note 锁定，5C-2 处理。
 * - **不可变事实纪律**：GrirRecord 为 immutable fact——只 create，绝不 UPDATE/DELETE；纠错只能追加。
 */

/** WHR POST 事务内：每 WHR Line 生成一条 GRIR ACCRUAL（同事务全有或全无——调用方 prisma.$transaction） */
export async function createGrirAccrualsForWhrPost(
  tx: Prisma.TransactionClient,
  params: {
    lines: Array<{ id: string; quantity: Prisma.Decimal; purchaseReceiptLineId: string }>;
    actorId: string;
    warehouseReceiptCode: string;
  },
): Promise<void> {
  if (params.lines.length === 0) return;

  // 溯源 PO 快照：WHR Line → PurchaseReceiptLine → PurchaseOrderLine（unitPrice/taxRate 快照）
  const prLineIds = [...new Set(params.lines.map((l) => l.purchaseReceiptLineId))];
  const prLines = await tx.purchaseReceiptLine.findMany({
    where: { id: { in: prLineIds }, deletedAt: null },
    select: { id: true, purchaseOrderLineId: true },
  });
  const poLineIds = [...new Set(prLines.map((p) => p.purchaseOrderLineId))];
  const poLines = await tx.purchaseOrderLine.findMany({
    where: { id: { in: poLineIds }, deletedAt: null },
    select: { id: true, unitPrice: true, taxRate: true },
  });
  const prById = new Map(prLines.map((p) => [p.id, p]));
  const poById = new Map(poLines.map((p) => [p.id, p]));

  for (const line of params.lines) {
    const prLine = prById.get(line.purchaseReceiptLineId);
    if (!prLine)
      throw new Error(
        'GRIR_ACCRUAL_SOURCE_MISSING: PurchaseReceiptLine 缺失（暂估事实无法生成，整个事务回滚）',
      );
    const poLine = poById.get(prLine.purchaseOrderLineId);
    if (!poLine)
      throw new Error(
        'GRIR_ACCRUAL_PO_SNAPSHOT_MISSING: PurchaseOrderLine 快照缺失（暂估事实无法生成，整个事务回滚）',
      );

    const unitPrice = poLine.unitPrice;
    const taxRate = poLine.taxRate;
    // 未税暂估净额（P9 Final：GRIR baseAmount = 不含税；进项税只在合规发票进入时确认）
    const baseAmount = line.quantity
      .mul(unitPrice)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const sourceKey = `ACCRUAL:WAREHOUSE_RECEIPT_LINE:${line.id}`;

    const existing = await tx.grirRecord.findFirst({ where: { sourceKey } });
    if (existing) continue; // 幂等（DB partial UNIQUE 兜底）

    await tx.grirRecord.create({
      data: {
        grirType: 'ACCRUAL',
        warehouseReceiptLineId: line.id,
        quantity: line.quantity,
        unitPrice,
        taxRate,
        baseAmount,
        sourceKey,
        remark: `WHR ${params.warehouseReceiptCode} POSTED 暂估（PO 快照单价/税率）`,
        createdById: params.actorId,
      },
    });
  }
}

export interface GrirReversalResult {
  /** 本行实际冲减的暂估数量（reversibleQty，>0 时创建了 REVERSAL） */
  reversibleQty: Prisma.Decimal;
  /** 超出 remaining unconsumed GRIR 的数量（>0 表示 AP correction pending，5C-2 CN/DN 处理） */
  pendingQty: Prisma.Decimal;
  /** 是否创建了 REVERSAL 事实 */
  created: boolean;
}

/**
 * PurchaseReturn RETURN 事务内：仅 WAREHOUSE_RECEIPT_LINE 来源行生成 GRIR REVERSAL。
 * remaining unconsumed = ΣACCRUAL - ΣREVERSAL - ΣCONSUME（对同一 WHR Line）；
 * reversibleQty = min(returnQty, remaining)；仅 > 0 创建 REVERSAL；超限部分返回 pending 供 Audit 留痕。
 * 幂等：DB partial UNIQUE（purchaseReturnLineId WHERE grirType='REVERSAL'）+ sourceKey UNIQUE 兜底。
 */
export async function createGrirReversalsForReturn(
  tx: Prisma.TransactionClient,
  params: {
    lines: Array<{
      id: string; // PurchaseReturnLine id
      quantity: Prisma.Decimal;
      sourceRefType: string;
      sourceWarehouseReceiptLineId: string | null;
    }>;
    actorId: string;
    purchaseReturnCode: string;
  },
): Promise<GrirReversalResult[]> {
  const results: GrirReversalResult[] = [];

  for (const line of params.lines) {
    // C0-C 边界：只对 WAREHOUSE_RECEIPT_LINE（已入库退货）产生 GRIR reversal；
    // RECEIPT_LINE / INSPECTION 从未形成已入库暂估事实 → 0 GRIR
    if (line.sourceRefType !== 'WAREHOUSE_RECEIPT_LINE' || !line.sourceWarehouseReceiptLineId) {
      results.push({
        reversibleQty: new Prisma.Decimal(0),
        pendingQty: new Prisma.Decimal(0),
        created: false,
      });
      continue;
    }
    const whrLineId = line.sourceWarehouseReceiptLineId;

    // remaining unconsumed GRIR（对同一 WHR Line）：ΣACCRUAL - ΣREVERSAL - ΣCONSUME
    const accrualAgg = await tx.grirRecord.aggregate({
      where: { grirType: 'ACCRUAL', warehouseReceiptLineId: whrLineId },
      _sum: { quantity: true },
    });
    // REVERSAL 记录本身不存 warehouseReceiptLineId（source_shape_check：REVERSAL 时该列必须 NULL），
    // 通过 PurchaseReturnLine.sourceWarehouseReceiptLineId 回溯到同一 WHR Line
    const reversalAgg = await tx.grirRecord.aggregate({
      where: {
        grirType: 'REVERSAL',
        purchaseReturnLine: { sourceWarehouseReceiptLineId: whrLineId },
      },
      _sum: { quantity: true },
    });
    // CONSUME 通过 SupplierInvoiceLine.warehouseReceiptLineId 回溯（5C-1C2 实现后生效；当前恒 0，公式先兼容）
    const consumeAgg = await tx.grirRecord.aggregate({
      where: {
        grirType: 'CONSUME',
        supplierInvoiceLine: { warehouseReceiptLineId: whrLineId },
      },
      _sum: { quantity: true },
    });
    const accrued = accrualAgg._sum.quantity ?? new Prisma.Decimal(0);
    const reversed = reversalAgg._sum.quantity ?? new Prisma.Decimal(0);
    const consumed = consumeAgg._sum.quantity ?? new Prisma.Decimal(0);
    const remainingUnconsumed = accrued.minus(reversed).minus(consumed);

    // CTO #9477 财务边界：reversibleQty = min(returnQty, remainingUnconsumed)；不得制造负 GRIR
    let reversibleQty = Prisma.Decimal.min(line.quantity, remainingUnconsumed);
    if (reversibleQty.isNegative()) reversibleQty = new Prisma.Decimal(0);
    const pendingQty = line.quantity.minus(reversibleQty);

    if (reversibleQty.gt(0)) {
      // REVERSAL 金额口径与对应 ACCRUAL 的 PO 快照一致（unitPrice/taxRate 取 ACCRUAL 快照）
      const accrualRecord = await tx.grirRecord.findFirst({
        where: { grirType: 'ACCRUAL', warehouseReceiptLineId: whrLineId },
        select: { unitPrice: true, taxRate: true },
        orderBy: { createdAt: 'asc' },
      });
      const unitPrice = accrualRecord?.unitPrice ?? new Prisma.Decimal(0);
      const taxRate = accrualRecord?.taxRate ?? new Prisma.Decimal(0);
      const baseAmount = reversibleQty
        .mul(unitPrice)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const sourceKey = `REVERSAL:PURCHASE_RETURN_LINE:${line.id}`;

      const existing = await tx.grirRecord.findFirst({ where: { sourceKey } });
      if (!existing) {
        const pendingNote = pendingQty.gt(0)
          ? `；另有 ${pendingQty.toFixed(4)} 超出 remaining unconsumed GRIR → AP correction pending / requires Supplier CN-DN（5C-2 处理）`
          : '';
        await tx.grirRecord.create({
          data: {
            grirType: 'REVERSAL',
            purchaseReturnLineId: line.id,
            quantity: reversibleQty,
            unitPrice,
            taxRate,
            baseAmount,
            sourceKey,
            remark: `PRT ${params.purchaseReturnCode} 冲减剩余暂估${pendingNote}`,
            createdById: params.actorId,
          },
        });
      }
    }

    results.push({ reversibleQty, pendingQty, created: reversibleQty.gt(0) });
  }

  return results;
}
