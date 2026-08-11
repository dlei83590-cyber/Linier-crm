import { Prisma } from '@prisma/client';

/**
 * Sprint 5C-1A - Supplier Invoice Foundation 领域通用函数（**不放路由逻辑**；对齐 6B helpers 模式）
 * 设计依据：Sprint5C_Supplier_Invoice_Three_Way_Match_AP_Gate.md + ADR-0027 + P1-P12 Final +
 *           CTO 5C-1 Schema Re-review #9048（99/100 FINAL APPROVED）+ CTO 5C-1A API 指令 #9083
 * - invoiceNo DocumentSequence **创建即取号**（SINV；docType=SUPPLIER_INVOICE 已由 5C-1A Seed，幂等 upsert）
 * - **RECEIPT_BASED 三重 Gate（红线 1）**：WHR header 必须 POSTED + WHR Line ↔ PO Line ↔ Item ↔ Supplier 来源链一致
 * - **金额全部服务端 Decimal 计算**（CTO 红线：Create/PATCH 都不信客户端头金额或行金额；schema 不收金额）
 * - Submit 只允许 DRAFT → SUBMITTED；不得提前创建 MatchRun/GRIR/ApLiabilityFact，不得写 POSTED evidence（5C-1B/1C 职责）
 * - 重复供应商发票号：API 稳定 409 + DB 组合 UNIQUE @@unique([supplierId, supplierInvoiceNo]) 最终防线
 * - 事件：5C-1A 阶段 DRAFT/SUBMITTED 仅 AuditLog（SupplierInvoiceCreated 注册位保持 ⏳——EVENTS v1.30 口径，不造新事件）
 */

/**
 * DocumentSequence 缺失 = **部署配置错误**（对齐 6B Sequence fail closed 治理）。
 * 缺失时**禁止生成临时编号**（fallback 会导致首次/第二次发票都拿到 SINV000001 → UNIQUE 冲突/不稳定 500，
 * 并掩盖真实部署配置错误）。缺失必须 fail closed。
 */
export class SupplierInvoiceSequenceMissingError extends Error {
  constructor() {
    super('SUPPLIER_INVOICE DocumentSequence 缺失（docType=SUPPLIER_INVOICE）——部署配置错误，请先执行 seed 初始化');
    this.name = 'SupplierInvoiceSequenceMissingError';
  }
}

/** DocumentSequence 原子取号（docType=SUPPLIER_INVOICE，前缀 SINV，位数 6；创建即取号 P1 Final；缺失 fail closed） */
export async function nextSupplierInvoiceNo(tx: Prisma.TransactionClient): Promise<string> {
  const seq = await tx.documentSequence.findFirst({
    where: { docType: 'SUPPLIER_INVOICE', isActive: true, deletedAt: null },
  });
  if (!seq) {
    throw new SupplierInvoiceSequenceMissingError();
  }
  const updated = await tx.documentSequence.update({
    where: { id: seq.id },
    data: { nextNo: { increment: 1 } },
  });
  return `${seq.prefix}${String(updated.nextNo - 1).padStart(seq.padLength, '0')}`;
}

/** 行金额服务端计算（CTO 红线：不信任客户端；全程 Decimal，禁 number 中间转换——对齐 6B canonical 纪律） */
export function computeSupplierInvoiceLineAmounts(params: {
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  taxRate: Prisma.Decimal; // 百分比（如 13 表示 13%）
  vatRecoverable: boolean;
}): {
  netAmount: Prisma.Decimal; // 行净额 = quantity × unitPrice（2dp）
  taxAmount: Prisma.Decimal; // 行税额 = netAmount × taxRate / 100（2dp）
  nonRecoverableTaxAmount: Prisma.Decimal; // vatRecoverable ? 0 : taxAmount（P9 Final：不可抵扣税 = 财务事实，不写库存成本层）
} {
  const netAmount = params.quantity.mul(params.unitPrice).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const taxAmount = netAmount.mul(params.taxRate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const nonRecoverableTaxAmount = params.vatRecoverable ? new Prisma.Decimal(0) : taxAmount;
  return { netAmount, taxAmount, nonRecoverableTaxAmount };
}

/** 头金额服务端聚合（net = Σ行净额；tax = Σ行税额；gross = net + tax；DB CHECK gross=net+tax 兜底） */
export function aggregateSupplierInvoiceTotals(
  lines: Array<{ netAmount: Prisma.Decimal; taxAmount: Prisma.Decimal }>,
): { netAmount: Prisma.Decimal; taxAmount: Prisma.Decimal; grossAmount: Prisma.Decimal } {
  const netAmount = lines.reduce((s, l) => s.plus(l.netAmount), new Prisma.Decimal(0)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const taxAmount = lines.reduce((s, l) => s.plus(l.taxAmount), new Prisma.Decimal(0)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const grossAmount = netAmount.add(taxAmount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return { netAmount, taxAmount, grossAmount };
}

/** 行去重键（同一发票内同一 PO Line 只允许开一次票——DB 无该 UNIQUE，API 前置去重 + 幂等语义） */
export function supplierInvoiceLineDedupeKey(line: { purchaseOrderLineId: string; warehouseReceiptLineId: string }): string {
  return `${line.purchaseOrderLineId}:${line.warehouseReceiptLineId}`;
}

/**
 * **RECEIPT_BASED 三重 Gate（红线 1，CTO #9048/#9083）**：
 * Create / PATCH / Submit 三处都调用（路由层三次验证），逐行验证：
 * ① WHR Line 存在且其 WHR header status == POSTED（DRAFT/CANCELLED 拒绝——只有 POSTED 才代表已入库事实）
 * ② WHR Line ↔ PO Line 一致：WHR Line → PurchaseReceiptLine.purchaseOrderLineId == 行提交的 purchaseOrderLineId
 * ③ Item ↔ Supplier 来源链一致：WHR Line.itemId 与 PO Line.itemId 一致；WHR → PurchaseReceipt.supplierId == 发票 supplierId
 * ④ 开票数量 ≤ 已入库数量（WHR Line.quantity；超过已收数量部分不可入 AP——红线）
 * ⑤ item 有效（存在 + isActive）
 *
 * 返回每行服务端解析的 itemId（从 WHR Line/PO Line 派生，**不信任客户端**——schema 行不收 itemId）。
 * 失败返回 { ok: false, error }，路由层映射到 SUPPLIER_INVOICE_* 错误码。
 */
export async function verifyReceiptBasedSourceChain(
  tx: Prisma.TransactionClient,
  params: {
    supplierId: string;
    /** Blocking ①（CTO #9161）：PATCH/Submit 排除当前发票自身旧行（自身已占用量不重复计入） */
    excludeInvoiceId?: string;
    lines: Array<{ purchaseOrderLineId: string; warehouseReceiptLineId: string; quantity: Prisma.Decimal }>;
  },
): Promise<
  | { ok: true; itemIds: Record<string, string | null> } // key = `${purchaseOrderLineId}:${warehouseReceiptLineId}` → itemId
  | { ok: false; error: 'WHR_NOT_POSTED' | 'SOURCE_CHAIN_MISMATCH' | 'ITEM_INVALID' | 'QUANTITY_INVALID' | 'CUMULATIVE_QTY_EXCEEDED' }
> {
  const itemIds: Record<string, string | null> = {};

  for (const line of params.lines) {
    const key = `${line.purchaseOrderLineId}:${line.warehouseReceiptLineId}`;

    // ① Lock WHR Line（FOR UPDATE）——Blocking ①（CTO #9161）：并发 Create/PATCH/Submit
    //    必须锁对应 WHR Line，避免两个请求同时读到相同 available（防累计超收双计）
    const lockedWhr = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "WarehouseReceiptLine" WHERE "id" = ${line.warehouseReceiptLineId} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (lockedWhr.length === 0) return { ok: false, error: 'SOURCE_CHAIN_MISMATCH' };

    // ② WHR Line 存在 + 所属 WHR header 状态
    const whrLine = await tx.warehouseReceiptLine.findFirst({
      where: { id: line.warehouseReceiptLineId, deletedAt: null },
      select: {
        id: true,
        itemId: true,
        quantity: true,
        purchaseReceiptLineId: true,
        warehouseReceipt: { select: { id: true, status: true, purchaseReceiptId: true } },
      },
    });
    if (!whrLine) return { ok: false, error: 'SOURCE_CHAIN_MISMATCH' };
    if (whrLine.warehouseReceipt.status !== 'POSTED') return { ok: false, error: 'WHR_NOT_POSTED' };

    // ③ 累计开票数量守恒（Blocking ①，CTO #9161）：
    //    本次数量 + 其他非 CANCELLED/非 deleted 发票行占用 ≤ WHR quantity
    //    （excludeInvoiceId 排除当前发票自身旧行——PATCH 行替换/Submit 时自身已占量不重复计入）
    const usedAgg = await tx.supplierInvoiceLine.aggregate({
      where: {
        warehouseReceiptLineId: line.warehouseReceiptLineId,
        deletedAt: null,
        supplierInvoice: {
          deletedAt: null,
          documentStatus: { not: 'CANCELLED' },
          ...(params.excludeInvoiceId ? { id: { not: params.excludeInvoiceId } } : {}),
        },
      },
      _sum: { quantity: true },
    });
    const usedQty = usedAgg._sum.quantity ?? new Prisma.Decimal(0);
    if (line.quantity.gt(whrLine.quantity)) {
      return { ok: false, error: 'QUANTITY_INVALID' }; // 单行本身超已入库
    }
    if (line.quantity.add(usedQty).gt(whrLine.quantity)) {
      return { ok: false, error: 'CUMULATIVE_QTY_EXCEEDED' }; // 含其他发票累计超已入库
    }

    // ④ WHR Line ↔ PO Line 一致：WHR Line 溯源收货行 → PO Line 必须等于行提交的 PO Line
    const prLine = await tx.purchaseReceiptLine.findFirst({
      where: { id: whrLine.purchaseReceiptLineId, deletedAt: null },
      select: { id: true, purchaseOrderLineId: true },
    });
    if (!prLine) return { ok: false, error: 'SOURCE_CHAIN_MISMATCH' };
    if (prLine.purchaseOrderLineId !== line.purchaseOrderLineId) return { ok: false, error: 'SOURCE_CHAIN_MISMATCH' };

    // ⑤ Item 来源链锁死（Blocking ②，CTO #9161）：RECEIPT_BASED 首版不允许 NULL 穿透——
    //    PO itemId != null 且 WHR itemId != null 且 PO itemId == WHR itemId 且 Item 有效
    const poLine = await tx.purchaseOrderLine.findFirst({
      where: { id: line.purchaseOrderLineId, deletedAt: null },
      select: { id: true, itemId: true },
    });
    if (!poLine) return { ok: false, error: 'SOURCE_CHAIN_MISMATCH' };
    if (!poLine.itemId || !whrLine.itemId) return { ok: false, error: 'ITEM_INVALID' }; // NULL 穿透拒绝
    if (poLine.itemId !== whrLine.itemId) return { ok: false, error: 'SOURCE_CHAIN_MISMATCH' };
    const itemId = poLine.itemId;
    const item = await tx.item.findFirst({ where: { id: itemId, deletedAt: null } });
    if (!item) return { ok: false, error: 'ITEM_INVALID' };

    // ⑥ Supplier 链一致：WHR → PurchaseReceipt.supplierId == 发票 supplierId
    const receipt = await tx.purchaseReceipt.findFirst({
      where: { id: whrLine.warehouseReceipt.purchaseReceiptId, deletedAt: null },
      select: { id: true, supplierId: true },
    });
    if (!receipt) return { ok: false, error: 'SOURCE_CHAIN_MISMATCH' };
    if (receipt.supplierId !== params.supplierId) return { ok: false, error: 'SOURCE_CHAIN_MISMATCH' };

    itemIds[key] = itemId;
  }

  return { ok: true, itemIds };
}
