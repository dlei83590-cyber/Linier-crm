import { Prisma } from "@prisma/client";

/** Sprint 4C - Delivery 领域辅助（编号生成 / Revision 创建 / 防超交分配计算）
 * 对齐 SalesOrder helpers 模式；CTO Review 锁定：
 * - deliveredQty 仅 status ∈ {DELIVERED, COMPLETED} 的 DeliveryLine 累计（confirm-delivery 才增加）
 * - DRAFT/READY/DISPATCHED 只动态占用 availableQty（不新增 allocatedQty 列）
 * - SalesOrderLine.deliveredQty / remainingQty 投影本阶段不写（仅 confirm-delivery 回写）
 */

export const DELIVERY_DOC_TYPE = "DELIVERY_ORDER";

/** 已确认交付状态（confirm-delivery 后，计入 confirmedDeliveredQty） */
const CONFIRMED_DELIVERY_STATUSES = ["DELIVERED", "COMPLETED"] as const;
/** 开放占用状态（DRAFT/READY/DISPATCHED，计入 openDeliveryQty 动态占用） */
const OPEN_DELIVERY_STATUSES = ["DRAFT", "READY", "DISPATCHED"] as const;

/** DocumentSequence 原子取号（docType=DELIVERY_ORDER，前缀 DO，位数 6） */
export async function nextDeliveryCode(tx: Prisma.TransactionClient): Promise<string> {
  const seq = await tx.documentSequence.findFirst({
    where: { docType: "DELIVERY_ORDER", isActive: true, deletedAt: null },
  });
  const prefix = seq?.prefix ?? "DO";
  const padLength = seq?.padLength ?? 6;
  if (seq) {
    const updated = await tx.documentSequence.update({
      where: { id: seq.id },
      data: { nextNo: { increment: 1 } },
    });
    return `${prefix}${String(updated.nextNo - 1).padStart(padLength, "0")}`;
  }
  return `${prefix}${String(1).padStart(padLength, "0")}`;
}

/** 创建 DeliveryRevision（系统生成，不开放自由编辑；revisionNo 自动递增） */
export async function createDeliveryRevision(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  changeReason: string,
  snapshotData: unknown,
  actorId?: string | null,
) {
  const last = await tx.deliveryRevision.findFirst({
    where: { deliveryId, deletedAt: null },
    orderBy: { revisionNo: "desc" },
  });
  const revisionNo = (last?.revisionNo ?? 0) + 1;
  return tx.deliveryRevision.create({
    data: {
      deliveryId,
      revisionNo,
      revisionStatus: "DRAFT",
      changeReason,
      snapshotData: snapshotData === undefined ? Prisma.JsonNull : (snapshotData as Prisma.InputJsonValue),
      createdById: actorId ?? null,
      updatedById: actorId ?? null,
    },
  });
}

/**
 * 计算某 SalesOrderLine 的可交付量（事务内动态计算，防超交；CTO Review ②拍板不新增 allocatedQty 列）
 * 前提：调用方已在同一事务内对源 SalesOrderLine 执行 FOR UPDATE 真实行锁。
 * confirmedDeliveredQty = 已 DELIVERED/COMPLETED 的有效 DeliveryLine.quantity 合计
 * openDeliveryQty       = 其他 DRAFT/READY/DISPATCHED DeliveryLine.quantity 合计
 * availableQty          = orderedQty - confirmedDeliveredQty - openDeliveryQty
 * PATCH 自身行时必须传 excludeDeliveryLineId，避免把旧 quantity 重复计入 openDeliveryQty。
 */
export async function computeDeliveryAllocation(
  tx: Prisma.TransactionClient,
  sourceSalesOrderLineId: string,
  excludeDeliveryLineId?: string,
): Promise<{ orderedQty: Prisma.Decimal; confirmedDeliveredQty: Prisma.Decimal; openDeliveryQty: Prisma.Decimal; availableQty: Prisma.Decimal } | null> {
  const soLine = await tx.salesOrderLine.findFirst({
    where: { id: sourceSalesOrderLineId, deletedAt: null },
    select: { id: true, quantity: true },
  });
  if (!soLine) return null;

  const confirmed = await tx.deliveryLine.aggregate({
    where: {
      sourceSalesOrderLineId,
      deletedAt: null,
      delivery: { status: { in: [...CONFIRMED_DELIVERY_STATUSES] }, deletedAt: null },
    },
    _sum: { quantity: true },
  });
  const open = await tx.deliveryLine.aggregate({
    where: {
      sourceSalesOrderLineId,
      deletedAt: null,
      ...(excludeDeliveryLineId ? { id: { not: excludeDeliveryLineId } } : {}),
      delivery: { status: { in: [...OPEN_DELIVERY_STATUSES] }, deletedAt: null },
    },
    _sum: { quantity: true },
  });
  const confirmedDeliveredQty = confirmed._sum.quantity ?? new Prisma.Decimal(0);
  const openDeliveryQty = open._sum.quantity ?? new Prisma.Decimal(0);
  const availableQty = soLine.quantity.minus(confirmedDeliveredQty).minus(openDeliveryQty);
  return { orderedQty: soLine.quantity, confirmedDeliveredQty, openDeliveryQty, availableQty };
}
