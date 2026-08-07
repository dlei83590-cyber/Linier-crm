import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failNotFound, failConflict, fail } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { deliveryCreateSchema } from "@/lib/api/schemas";
import { nextDeliveryCode, createDeliveryRevision, computeDeliveryAllocation } from "@/lib/delivery/helpers";
import { publishDeliveryEvent } from "@/lib/delivery/events";

export const dynamic = "force-dynamic";

/** 允许创建 Delivery 的来源 SO 状态（CTO Review ⑥：DELIVERED=客户确认收货；DRAFT/CANCELLED/COMPLETED 不允许） */
const DELIVERABLE_SO_STATUSES = ["CONFIRMED", "PARTIALLY_DELIVERED"] as const;

/**
 * POST /api/sales-orders/{salesOrderId}/deliveries（唯一创建入口；CTO Review ①拍板：Direct Delivery 禁止，
 * 不开放 POST /api/deliveries；salesOrderId NOT NULL）
 * 流程（事务内，CTO Review ②防超交）：
 *  FOR UPDATE 锁定来源 SO（串行化同一 SO 并发建单）
 *  → 校验 SO 状态 ∈ {CONFIRMED, PARTIALLY_DELIVERED}
 *  → 原子取号（DocumentSequence docType=DELIVERY_ORDER，前缀 DO，位数 6）
 *  → 创建 Delivery（status=DRAFT，customerId 继承 SO.customerId）
 *  → 若请求传入 lines：逐行 FOR UPDATE 锁定 source SalesOrderLine
 *     → 动态计算 confirmedDeliveredQty / openDeliveryQty / availableQty
 *     → 校验 quantity <= availableQty（超出 → 409 DELIVERY_QUANTITY_EXCEEDED）
 *     → 写 DeliveryLine（快照 description/orderedQty/deliveredQty/itemId/uomId 从 SO Line 继承）
 *  → 生成 DeliveryRevision + DeliverySnapshot(CREATED)
 * 本阶段不增加 SalesOrderLine.deliveredQty / remainingQty（仅 confirm-delivery 回写，锁定项）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ salesOrderId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "delivery:create");
  if (denied) return denied;
  requestLog(request, user?.id, "delivery.create");

  const { salesOrderId } = await params;
  const parsed = deliveryCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { lines, changeReason, ...fields } = parsed.data;
  const meta = requestMeta(request);

  const result = await prisma.$transaction(async (tx) => {
    // ① 真实数据库行锁：锁定来源 SalesOrder，串行化同一 SO 的并发建单
    const lockedSo = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "SalesOrder" WHERE "id" = ${salesOrderId} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (lockedSo.length === 0) return { error: "SO_NOT_FOUND" as const };

    const salesOrder = await tx.salesOrder.findFirst({
      where: { id: salesOrderId, deletedAt: null },
      include: { lines: { where: { deletedAt: null }, orderBy: { lineNo: "asc" } } },
    });
    if (!salesOrder) return { error: "SO_NOT_FOUND" as const };
    if ((DELIVERABLE_SO_STATUSES as readonly string[]).includes(salesOrder.status) === false) {
      return { error: "SO_NOT_DELIVERABLE" as const, status: salesOrder.status };
    }

    // ② 原子取号（DocumentSequence docType=DELIVERY_ORDER，前缀 DO，位数 6）
    const code = await nextDeliveryCode(tx);

    // ③ 创建 Delivery 头（status=DRAFT；customerId 继承 SO.customerId；deliveryDate 默认 now）
    const delivery = await tx.delivery.create({
      data: {
        code,
        salesOrderId,
        customerId: salesOrder.customerId,
        status: "DRAFT",
        deliveryDate: fields.deliveryDate ? new Date(fields.deliveryDate) : new Date(),
        ...(fields.expectedArrivalDate !== undefined
          ? { expectedArrivalDate: fields.expectedArrivalDate ? new Date(fields.expectedArrivalDate) : null }
          : {}),
        ...(fields.carrier !== undefined ? { carrier: fields.carrier } : {}),
        ...(fields.trackingNo !== undefined ? { trackingNo: fields.trackingNo } : {}),
        ...(fields.remark !== undefined ? { remark: fields.remark } : {}),
        createdById: user!.id,
        updatedById: user!.id,
      },
    });

    // ④ 行：请求明确传入才创建（不默认复制全部剩余行；CTO 指示：适合分批发货）
    const createdLines: Array<{ id: string; lineNo: number; sourceSalesOrderLineId: string | null; quantity: unknown }> = [];
    if (lines && lines.length > 0) {
      const soLineMap = new Map(salesOrder.lines.map((l) => [l.id, l]));
      let lineNo = 10;
      for (const lineInput of lines) {
        const soLine = soLineMap.get(lineInput.sourceSalesOrderLineId);
        if (!soLine) return { error: "SOURCE_LINE_INVALID" as const, lineId: lineInput.sourceSalesOrderLineId };

        // ④a 锁定 source SalesOrderLine（FOR UPDATE），防并发超交
        const lockedLine = await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT "id" FROM "SalesOrderLine" WHERE "id" = ${soLine.id} AND "deletedAt" IS NULL FOR UPDATE`,
        );
        if (lockedLine.length === 0) return { error: "SOURCE_LINE_INVALID" as const, lineId: soLine.id };

        // ④b 动态计算可交付量（CTO Review ②：不新增 allocatedQty 列）
        const alloc = await computeDeliveryAllocation(tx, soLine.id);
        if (!alloc) return { error: "SOURCE_LINE_INVALID" as const, lineId: soLine.id };
        const quantity = new Prisma.Decimal(lineInput.quantity);
        if (quantity.greaterThan(alloc.availableQty)) {
          return {
            error: "QUANTITY_EXCEEDED" as const,
            lineId: soLine.id,
            requested: quantity.toString(),
            availableQty: alloc.availableQty.toString(),
          };
        }

        // ④c 写 DeliveryLine（快照字段从 SO Line 继承；本阶段不写 SalesOrderLine.deliveredQty/remainingQty）
        const line = await tx.deliveryLine.create({
          data: {
            deliveryId: delivery.id,
            sourceSalesOrderLineId: soLine.id,
            lineNo,
            itemId: soLine.itemId,
            description: soLine.description,
            quantity,
            uomId: soLine.uomId,
            orderedQty: soLine.quantity,
            deliveredQty: soLine.deliveredQty,
            createdById: user!.id,
            updatedById: user!.id,
          },
        });
        createdLines.push({ id: line.id, lineNo, sourceSalesOrderLineId: soLine.id, quantity });
        lineNo += 10;
      }
    }

    // ⑤ Revision + CREATED 快照（创建时固化；对齐 SalesOrder convert 行为）
    const snapshotData = {
      delivery: { id: delivery.id, code: delivery.code, salesOrderId, customerId: delivery.customerId, status: delivery.status },
      lines: createdLines,
    };
    await createDeliveryRevision(tx, delivery.id, changeReason ?? "创建交付单", snapshotData, user?.id);
    await tx.deliverySnapshot.create({
      data: {
        deliveryId: delivery.id,
        snapshotType: "CREATED",
        revisionNo: 1,
        snapshotData: snapshotData as Prisma.InputJsonValue,
        generatedById: user?.id,
        createdById: user?.id,
      },
    });

    return { delivery, lines: createdLines };
  });

  if ("error" in result) {
    switch (result.error) {
      case "SO_NOT_FOUND":
        return failNotFound(ERROR_CODES.SALES_ORDER_NOT_FOUND, "销售订单不存在");
      case "SO_NOT_DELIVERABLE":
        return failConflict(ERROR_CODES.SALES_ORDER_NOT_DELIVERABLE, `销售订单状态不允许创建交付单（当前 ${result.status}，仅 CONFIRMED/PARTIALLY_DELIVERED）`);
      case "SOURCE_LINE_INVALID":
        return fail(ERROR_CODES.DELIVERY_SOURCE_LINE_INVALID, "交付行来源销售订单行无效或不属于该销售订单", 400, { lineId: result.lineId });
      case "QUANTITY_EXCEEDED":
        return failConflict(
          ERROR_CODES.DELIVERY_QUANTITY_EXCEEDED,
          `交付数量超过可交付量（请求 ${result.requested}，availableQty ${result.availableQty}），禁止超交`,
        );
    }
  }

  const delivery = result.delivery;
  await publishDeliveryEvent({
    eventType: "DeliveryCreated",
    actorId: user?.id,
    entityId: delivery.id,
    payload: {
      deliveryId: delivery.id,
      deliveryCode: delivery.code,
      salesOrderId,
      customerId: delivery.customerId,
      lineCount: result.lines.length,
    },
    meta,
  });
  await writeAuditLog({
    actorId: user?.id,
    action: "delivery.create",
    entityType: "delivery",
    entityId: delivery.id,
    afterData: { code: delivery.code, salesOrderId, lineCount: result.lines.length },
    ...meta,
  });

  return ok({ ...delivery, lines: result.lines });
}
