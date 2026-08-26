import { Prisma } from "@prisma/client";
import { nextDocumentCode } from "@/lib/document-sequence/next-code";

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

/** DocumentSequence 原子取号（docType=DELIVERY_ORDER，前缀 DO；单据序列重构：DO-LNE{YYYY}{MM}{####}） */
export async function nextDeliveryCode(tx: Prisma.TransactionClient, documentDate: Date): Promise<string> {
  return nextDocumentCode(tx, "DELIVERY_ORDER", documentDate);
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

/** 创建 DeliverySnapshot（固化节点生成；revisionNo 取当前最新修订号；Decimal 一律 toString 落 JSON，禁止 toNumber） */
export async function createDeliverySnapshot(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  snapshotType: "READY" | "DISPATCHED" | "DELIVERED" | "CANCELLED",
  revisionNo: number,
  snapshotData: unknown,
  actorId?: string | null,
) {
  return tx.deliverySnapshot.create({
    data: {
      deliveryId,
      snapshotType,
      revisionNo,
      snapshotData: snapshotData === undefined ? Prisma.JsonNull : (snapshotData as Prisma.InputJsonValue),
      generatedById: actorId ?? null,
      createdById: actorId ?? null,
      updatedById: actorId ?? null,
    },
  });
}

/** 取 Delivery 当前最新修订号（快照对应；无修订时回退 1） */
export async function latestDeliveryRevisionNo(
  tx: Prisma.TransactionClient,
  deliveryId: string,
): Promise<number> {
  const last = await tx.deliveryRevision.findFirst({
    where: { deliveryId, deletedAt: null },
    orderBy: { revisionNo: "desc" },
    select: { revisionNo: true },
  });
  return last?.revisionNo ?? 1;
}

/**
 * 计算某 SalesOrderLine 的可交付量（事务内动态计算，防超交；CTO Review ②拍板不新增 allocatedQty 列）
 * 前提：调用方已在同一事务内对源 SalesOrderLine 执行 FOR UPDATE 真实行锁。
 * confirmedDeliveredQty = 已 DELIVERED/COMPLETED 的有效 DeliveryLine.quantity 合计
 * openDeliveryQty       = 其他 DRAFT/READY/DISPATCHED DeliveryLine.quantity 合计
 * availableQty          = orderedQty - confirmedDeliveredQty - openDeliveryQty
 * PATCH 自身行时必须传 excludeDeliveryLineId，避免把旧 quantity 重复计入 openDeliveryQty；
 * ready 重新校验时可传 excludeDeliveryId（排除整个 Delivery 自身的占用，避免把自己算进 open）。
 */
export async function computeDeliveryAllocation(
  tx: Prisma.TransactionClient,
  sourceSalesOrderLineId: string,
  excludeDeliveryLineId?: string,
  excludeDeliveryId?: string,
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
      ...(excludeDeliveryId ? { deliveryId: { not: excludeDeliveryId } } : {}),
      delivery: { status: { in: [...OPEN_DELIVERY_STATUSES] }, deletedAt: null },
    },
    _sum: { quantity: true },
  });
  const confirmedDeliveredQty = confirmed._sum.quantity ?? new Prisma.Decimal(0);
  const openDeliveryQty = open._sum.quantity ?? new Prisma.Decimal(0);
  const availableQty = soLine.quantity.minus(confirmedDeliveredQty).minus(openDeliveryQty);
  return { orderedQty: soLine.quantity, confirmedDeliveredQty, openDeliveryQty, availableQty };
}
