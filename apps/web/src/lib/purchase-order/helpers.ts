import { Prisma } from '@prisma/client';
import type { PurchaseOrderLine, PrismaClient } from '@prisma/client';

/**
 * Sprint 5A - PurchaseOrder 领域通用函数（**不放路由逻辑**；对齐 PR/Invoice helpers 模式）
 * 设计依据：ADR-0023（Approved with Changes）+ CTO Design Review 97/100 + Phase 3 Review：
 * - **PO = 采购承诺事实源**：行金额 = 快照复制（SUPPLIER_PRICE_SNAPSHOT 优先 / MANUAL 授权双通道——拍板③），
 *   头金额 = 服务端 Decimal 聚合（subtotal/taxAmount/totalAmount），**客户端不可直接传总额**；
 * - **PO 不调 Pricing Engine、不重算**（对齐销售侧价格红线）；税率快照复制（拍板④：税档变化不影响已 APPROVED PO）；
 * - code DocumentSequence **创建即取号**（PO-2026-xxxx；docType=PURCHASE_ORDER 已有，seed 已存在，不重复新增）；
 * - **生命周期锁死（拍板调整③）**：DRAFT→SUBMITTED→APPROVED→CONFIRMED→PARTIALLY_RECEIVED→RECEIVED；
 *   **APPROVED ≠ CONFIRMED**，只有 Confirmed PO 才是 5B GR 来源；
 * - PO Line 预留投影 `receivedQty=0 / remainingReceiveQty=quantity`（创建时初始化；**5A 禁客户端改，5B 唯一回写方**）；
 * - **sourceType = REQUISITION | DIRECT**（拍板②）：Convert 保留 sourcePurchaseRequisitionLineId，Direct 为空；
 * - 金额始终 `Prisma.Decimal`，**禁止 number 中间转换**（CTO 红线：Decimal 无 Float/Number 转换）。
 */

/** DocumentSequence 原子取号（docType=PURCHASE_ORDER，前缀 PO，位数 6；创建即取号） */
export async function nextPurchaseOrderCode(tx: Prisma.TransactionClient): Promise<string> {
  const seq = await tx.documentSequence.findFirst({
    where: { docType: 'PURCHASE_ORDER', isActive: true, deletedAt: null },
  });
  const prefix = seq?.prefix ?? 'PO';
  const padLength = seq?.padLength ?? 6;
  if (seq) {
    const updated = await tx.documentSequence.update({
      where: { id: seq.id },
      data: { nextNo: { increment: 1 } },
    });
    return `${prefix}${String(updated.nextNo - 1).padStart(padLength, '0')}`;
  }
  return `${prefix}${String(1).padStart(padLength, '0')}`;
}

/** 行金额算术（与 Invoice computeInvoiceLineAmounts 公式一致，不调用 Pricing Engine）：
 * lineAmount = unitPrice × quantity；taxAmount = lineAmount × taxRate / 100；totalAmount = lineAmount + taxAmount
 * 价格参数（unitPrice/taxRate）100% 复制自溯源快照（PartnerPrice / MANUAL 录入），不重新询价。
 */
export function computePurchaseOrderLineAmounts(params: {
  unitPrice: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  quantity: Prisma.Decimal;
}): { lineAmount: Prisma.Decimal; taxAmount: Prisma.Decimal; totalAmount: Prisma.Decimal } {
  const lineAmount = params.unitPrice.mul(params.quantity);
  const taxAmount = lineAmount.mul(params.taxRate).div(100);
  const totalAmount = lineAmount.add(taxAmount);
  return { lineAmount, taxAmount, totalAmount };
}

/** 重算 PO 头合计（subtotal/taxAmount/totalAmount，全程 Decimal；服务端聚合，禁客户端直传） */
export async function recalcPurchaseOrderTotals(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string,
  lines: Array<Pick<PurchaseOrderLine, 'lineAmount' | 'taxAmount' | 'totalAmount'>>,
) {
  const subtotal = lines.reduce((s, l) => s.plus(l.lineAmount), new Prisma.Decimal(0));
  const taxAmount = lines.reduce((s, l) => s.plus(l.taxAmount), new Prisma.Decimal(0));
  const totalAmount = lines.reduce((s, l) => s.plus(l.totalAmount), new Prisma.Decimal(0));
  return tx.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: { subtotal, taxAmount, totalAmount },
  });
}

/** 取 Supplier 有效价格快照（SUPPLIER_PRICE_SNAPSHOT 通道；partnerId=supplier.partnerId + itemId + priceSource=SUPPLIER）
 * 返回 { partnerPriceId, unitPrice, taxRate }；未命中返回 null（调用方决定 409 或回退 MANUAL）。
 * 税率：PartnerPrice.taxProfile.rate（CUSTOM 百分比；无税档按 0）。 */
export async function resolveSupplierPriceSnapshot(
  tx: Prisma.TransactionClient | PrismaClient,
  params: { partnerId: string; itemId: string },
): Promise<{ partnerPriceId: string; unitPrice: Prisma.Decimal; taxRate: Prisma.Decimal } | null> {
  const price = await tx.partnerPrice.findFirst({
    where: {
      partnerId: params.partnerId,
      itemId: params.itemId,
      priceSource: 'SUPPLIER',
      isActive: true,
      deletedAt: null,
    },
    orderBy: [{ priority: 'asc' }, { updatedAt: 'desc' }],
    include: { taxProfile: { select: { rate: true } } },
  });
  if (!price) return null;
  return {
    partnerPriceId: price.id,
    unitPrice: price.unitPrice,
    taxRate: price.taxProfile?.rate
      ? new Prisma.Decimal(price.taxProfile.rate)
      : new Prisma.Decimal(0),
  };
}

/** 创建 PO Revision（修改必须产生 Revision；变更前快照 Header + Lines） */
export async function createPurchaseOrderRevision(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string,
  changeReason: string,
  snapshotData: unknown,
  actorId?: string | null,
) {
  const last = await tx.purchaseOrderRevision.findFirst({
    where: { purchaseOrderId, deletedAt: null },
    orderBy: { revisionNo: 'desc' },
  });
  const revisionNo = (last?.revisionNo ?? 0) + 1;
  return tx.purchaseOrderRevision.create({
    data: {
      purchaseOrderId,
      revisionNo,
      changeReason,
      snapshotData:
        snapshotData === undefined ? Prisma.JsonNull : (snapshotData as Prisma.InputJsonValue),
      createdById: actorId ?? null,
      updatedById: actorId ?? null,
    },
  });
}

/** 创建 PO Snapshot（固化节点生成；revisionNo 取当前最新修订号；Decimal 一律 toString 落 JSON，禁止 toNumber） */
export async function createPurchaseOrderSnapshot(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string,
  snapshotType: 'CREATED' | 'SUBMITTED' | 'APPROVED' | 'CONFIRMED' | 'RECEIVED' | 'CANCELLED',
  snapshotData: unknown,
  actorId?: string | null,
) {
  const last = await tx.purchaseOrderRevision.findFirst({
    where: { purchaseOrderId, deletedAt: null },
    orderBy: { revisionNo: 'desc' },
    select: { revisionNo: true },
  });
  return tx.purchaseOrderSnapshot.create({
    data: {
      purchaseOrderId,
      snapshotType,
      revisionNo: last?.revisionNo ?? 1,
      snapshotData:
        snapshotData === undefined ? Prisma.JsonNull : (snapshotData as Prisma.InputJsonValue),
      generatedById: actorId ?? null,
      createdById: actorId ?? null,
      updatedById: actorId ?? null,
    },
  });
}
