import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, fail } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { invoiceCreateSchema } from "@/lib/api/schemas";
import { createInvoiceRevision, createInvoiceSnapshot, latestInvoiceRevisionNo, computeInvoiceLineAmounts } from "@/lib/invoice/helpers";
import { publishInvoiceEvent } from "@/lib/invoice/events";

export const dynamic = "force-dynamic";

/**
 * POST /api/deliveries/:id/invoice —— 唯一开票入口（Direct Invoice 禁止；不开放 POST /api/invoices）
 * 路径 {id} = primaryDeliveryId（本阶段单 Delivery + Partial Billing；Consolidated deliveryIds[] 扩展见后续 commit）
 *
 * Create 事务链路（CTO Review 96/100 锁定 + 用户锁定顺序）：
 *  1. FOR UPDATE 锁定来源 Delivery
 *  2. 校验 DELIVERED（仅已确认收货可开票）
 *  3. 读取 SalesOrder 财务属性（currency/taxProfileId/paymentTerm）填充 Invoice 头
 *  4. 按 id ASC 锁定涉及的 DeliveryLine（FOR UPDATE）+ 校验归属本 Delivery
 *  5. 防超开票：requestedQty > 0 且 <= remainingInvoiceQty（锁内读；否则 409 INVOICE_QUANTITY_EXCEEDED）
 *  6. 沿四段溯源链取价：DeliveryLine → sourceSalesOrderLineId → SalesOrderLine → priceSnapshotId → QuotationPriceSnapshot
 *     （不调用 Pricing Engine——Pricing 到 SalesOrder 为止；价格参数复制，行金额 = unitPrice × quantity 算术）
 *  7. 创建 Invoice(DRAFT, code=null)（编号延后生成，ISSUE 时才取号）
 *  8. 创建 InvoiceLine（金额快照：priceSnapshotId/unitPrice/discountRate/lineAmount/taxAmount/totalAmount）
 *  9. 回写 DeliveryLine 开票投影（invoicedQty += qty；remainingInvoiceQty -= qty）
 *  10. 创建 Revision
 *  11. 创建 CREATED Snapshot（Decimal 一律 toString + 税务/汇率快照字段）
 *  12. AuditLog + InvoiceCreated（事务外，事件失败不阻断）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "invoice:create");
  if (denied) return denied;
  requestLog(request, user?.id, "invoice.create");

  const { id: primaryDeliveryId } = await params;
  const parsed = invoiceCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { lines, invoiceDate, dueDate, remark, changeReason } = parsed.data;
  const meta = requestMeta(request);

  const result = await prisma.$transaction(async (tx) => {
    // ── 1. FOR UPDATE 锁定来源 Delivery ────────────────────────────────────
    const lockedDelivery = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "Delivery" WHERE "id" = ${primaryDeliveryId} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (lockedDelivery.length === 0) return { error: "DELIVERY_NOT_FOUND" as const };
    const delivery = await tx.delivery.findFirst({ where: { id: primaryDeliveryId, deletedAt: null } });
    if (!delivery) return { error: "DELIVERY_NOT_FOUND" as const };

    // ── 2. 校验 DELIVERED（仅已确认收货可开票） ────────────────────────────
    if (delivery.status !== "DELIVERED") {
      return { error: "SOURCE_NOT_DELIVERED" as const, status: delivery.status };
    }

    // ── 3. 读取 SalesOrder 财务属性（currency/taxProfileId/paymentTerm） ────
    const salesOrder = await tx.salesOrder.findFirst({ where: { id: delivery.salesOrderId, deletedAt: null } });
    if (!salesOrder) return { error: "SO_NOT_FOUND" as const };

    // ── 4. 按 id ASC 锁定涉及的 DeliveryLine（FOR UPDATE）+ 校验归属本 Delivery ──
    const lineIds = [...new Set(lines.map((l) => l.deliveryLineId))].sort();
    const lineMap = new Map<
      string,
      {
        id: string;
        deliveryId: string;
        sourceSalesOrderLineId: string | null;
        itemId: string | null;
        description: string;
        uomId: string | null;
        remainingInvoiceQty: Prisma.Decimal;
        invoicedQty: Prisma.Decimal;
        sourceSalesOrderLine: { priceSnapshotId: string | null; unitPrice: Prisma.Decimal; priceSnapshot: { discountRate: Prisma.Decimal; taxRate: Prisma.Decimal | null } | null } | null;
      }
    >();
    for (const lid of lineIds) {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "DeliveryLine" WHERE "id" = ${lid} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (locked.length === 0) return { error: "LINE_NOT_FOUND" as const, lineId: lid };
      const dl = await tx.deliveryLine.findFirst({
        where: { id: lid, deletedAt: null },
        include: { sourceSalesOrderLine: { include: { priceSnapshot: true } } },
      });
      if (!dl) return { error: "LINE_NOT_FOUND" as const, lineId: lid };
      if (dl.deliveryId !== primaryDeliveryId) {
        return { error: "LINE_NOT_IN_SOURCE" as const, lineId: lid, deliveryId: dl.deliveryId };
      }
      lineMap.set(lid, dl as never);
    }

    // ── 5. 防超开票 + 溯源取价 + 行金额（锁内读 remainingInvoiceQty，禁止事务外读算写） ──
    let lineNo = 10;
    let subtotal = new Prisma.Decimal(0);
    let taxTotal = new Prisma.Decimal(0);
    let grandTotal = new Prisma.Decimal(0);
    const invoiceLinesData: Array<{
      sourceDeliveryLineId: string;
      lineNo: number;
      itemId: string | null;
      description: string;
      quantity: Prisma.Decimal;
      uomId: string | null;
      priceSnapshotId: string | null;
      unitPrice: Prisma.Decimal;
      discountRate: Prisma.Decimal;
      lineAmount: Prisma.Decimal;
      taxAmount: Prisma.Decimal;
      totalAmount: Prisma.Decimal;
    }> = [];

    for (const item of lines) {
      const dl = lineMap.get(item.deliveryLineId);
      if (!dl) return { error: "LINE_NOT_FOUND" as const, lineId: item.deliveryLineId };
      const qty = new Prisma.Decimal(item.quantity);
      if (qty.lte(0)) return { error: "QTY_INVALID" as const, lineId: dl.id };
      // Partial Billing 防超开票：requestedQty <= remainingInvoiceQty
      if (qty.greaterThan(dl.remainingInvoiceQty)) {
        return {
          error: "QUANTITY_EXCEEDED" as const,
          lineId: dl.id,
          requested: qty.toString(),
          remainingInvoiceQty: dl.remainingInvoiceQty.toString(),
        };
      }
      // 四段溯源链取价：DeliveryLine → SalesOrderLine → QuotationPriceSnapshot（不调用 Pricing Engine）
      const sol = dl.sourceSalesOrderLine;
      if (!sol || !sol.priceSnapshotId) {
        return { error: "SOURCE_LINE_INVALID" as const, lineId: dl.id };
      }
      const ps = sol.priceSnapshot;
      const unitPrice = sol.unitPrice; // 快照单价（继承，不重算）
      const discountRate = ps?.discountRate ?? new Prisma.Decimal(0);
      const taxRate = ps?.taxRate ?? new Prisma.Decimal(0);
      const amounts = computeInvoiceLineAmounts({ unitPrice, taxRate, quantity: qty });
      invoiceLinesData.push({
        sourceDeliveryLineId: dl.id,
        lineNo,
        itemId: dl.itemId,
        description: dl.description,
        quantity: qty,
        uomId: dl.uomId,
        priceSnapshotId: sol.priceSnapshotId,
        unitPrice,
        discountRate,
        lineAmount: amounts.lineAmount,
        taxAmount: amounts.taxAmount,
        totalAmount: amounts.totalAmount,
      });
      subtotal = subtotal.plus(amounts.lineAmount);
      taxTotal = taxTotal.plus(amounts.taxAmount);
      grandTotal = grandTotal.plus(amounts.totalAmount);
      lineNo += 10;
    }

    // ── 6. 创建 Invoice（DRAFT, code=null——编号延后生成） ───────────────────
    const invoice = await tx.invoice.create({
      data: {
        deliveryId: primaryDeliveryId,
        salesOrderId: delivery.salesOrderId,
        customerId: delivery.customerId,
        status: "DRAFT",
        invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
        ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
        currency: salesOrder.currency,
        taxProfileId: salesOrder.taxProfileId,
        paymentTerm: salesOrder.paymentTerm,
        subtotal,
        taxAmount: taxTotal,
        invoiceTotal: grandTotal,
        paidAmount: new Prisma.Decimal(0),
        balanceAmount: grandTotal,
        ...(remark !== undefined ? { remark } : {}),
        createdById: user!.id,
        updatedById: user!.id,
      },
    });

    // ── 7. 创建 InvoiceLine（金额快照复制；sourceDeliveryLineId 溯源） ───────
    for (const l of invoiceLinesData) {
      await tx.invoiceLine.create({
        data: {
          invoiceId: invoice.id,
          sourceDeliveryLineId: l.sourceDeliveryLineId,
          lineNo: l.lineNo,
          itemId: l.itemId,
          description: l.description,
          quantity: l.quantity,
          uomId: l.uomId,
          priceSnapshotId: l.priceSnapshotId,
          unitPrice: l.unitPrice,
          discountRate: l.discountRate,
          lineAmount: l.lineAmount,
          taxAmount: l.taxAmount,
          totalAmount: l.totalAmount,
          createdById: user!.id,
          updatedById: user!.id,
        },
      });
    }

    // ── 8. 回写 DeliveryLine 开票投影（invoicedQty += qty；remainingInvoiceQty -= qty） ──
    for (const item of lines) {
      const dl = lineMap.get(item.deliveryLineId)!;
      const qty = new Prisma.Decimal(item.quantity);
      await tx.deliveryLine.update({
        where: { id: dl.id },
        data: {
          invoicedQty: dl.invoicedQty.plus(qty),
          remainingInvoiceQty: dl.remainingInvoiceQty.minus(qty),
          updatedById: user!.id,
        },
      });
    }

    // ── 9. Revision + CREATED Snapshot（Decimal toString；税务/汇率快照） ────
    const snapshotData = {
      invoiceId: invoice.id,
      code: null,
      status: "DRAFT",
      deliveryId: primaryDeliveryId,
      salesOrderId: delivery.salesOrderId,
      customerId: delivery.customerId,
      currency: salesOrder.currency,
      taxProfileId: salesOrder.taxProfileId,
      paymentTerm: salesOrder.paymentTerm,
      subtotal: subtotal.toString(),
      taxAmount: taxTotal.toString(),
      invoiceTotal: grandTotal.toString(),
      paidAmount: "0",
      balanceAmount: grandTotal.toString(),
      lines: invoiceLinesData.map((l) => ({
        sourceDeliveryLineId: l.sourceDeliveryLineId,
        lineNo: l.lineNo,
        quantity: l.quantity.toString(),
        unitPrice: l.unitPrice.toString(),
        discountRate: l.discountRate.toString(),
        lineAmount: l.lineAmount.toString(),
        taxAmount: l.taxAmount.toString(),
        totalAmount: l.totalAmount.toString(),
        priceSnapshotId: l.priceSnapshotId,
      })),
    };
    await createInvoiceRevision(tx, invoice.id, changeReason ?? "创建发票", snapshotData, user?.id);
    const revisionNo = await latestInvoiceRevisionNo(tx, invoice.id);
    const firstPs = lineMap.get(lines[0].deliveryLineId)?.sourceSalesOrderLine?.priceSnapshot;
    await createInvoiceSnapshot(
      tx,
      invoice.id,
      "CREATED",
      revisionNo,
      snapshotData,
      user?.id,
      {
        taxProfileId: salesOrder.taxProfileId,
        taxRate: firstPs?.taxRate ?? null,
        sstNo: null, // SST 注册号（TaxProfile 无此字段，待配置来源）
        currencyRate: null, // 汇率快照（待币种汇率配置；4E 前可扩展）
        exchangeRate: null,
      },
    );

    return { invoice, lineCount: invoiceLinesData.length };
  });

  if ("error" in result) {
    switch (result.error) {
      case "DELIVERY_NOT_FOUND":
        return failNotFound(ERROR_CODES.DELIVERY_NOT_FOUND, "来源交付单不存在");
      case "SO_NOT_FOUND":
        return failNotFound(ERROR_CODES.SALES_ORDER_NOT_FOUND, "来源销售订单不存在");
      case "SOURCE_NOT_DELIVERED":
        return failConflict(
          ERROR_CODES.INVOICE_INVALID_STATE,
          `仅 DELIVERED 状态可开票（当前 ${result.status}）`,
        );
      case "LINE_NOT_FOUND":
        return failNotFound(ERROR_CODES.INVOICE_LINE_NOT_FOUND, "开票行（DeliveryLine）不存在");
      case "LINE_NOT_IN_SOURCE":
        return failConflict(
          ERROR_CODES.INVOICE_INVALID_STATE,
          `开票行 ${result.lineId} 不属于该交付单（属于 ${result.deliveryId}）`,
        );
      case "SOURCE_LINE_INVALID":
        return fail(ERROR_CODES.DELIVERY_SOURCE_LINE_INVALID, "交付行来源销售订单行无效或已删除", 400, { lineId: result.lineId });
      case "QTY_INVALID":
        return failConflict(ERROR_CODES.INVOICE_INVALID_STATE, "开票数量必须大于 0");
      case "QUANTITY_EXCEEDED":
        return failConflict(
          ERROR_CODES.INVOICE_QUANTITY_EXCEEDED,
          `开票数量超过剩余可开票量（请求 ${result.requested}，remainingInvoiceQty ${result.remainingInvoiceQty}），禁止超开票`,
        );
    }
  }

  // ── 10. 事件 + 审计（事务外，与现有模式一致；事件失败不阻断） ─────────────
  try {
    await publishInvoiceEvent({
      eventType: "InvoiceCreated",
      actorId: user?.id,
      entityId: result.invoice.id,
      payload: {
        invoiceId: result.invoice.id,
        invoiceCode: null,
        deliveryId: primaryDeliveryId,
        salesOrderId: result.invoice.salesOrderId,
        customerId: result.invoice.customerId,
        currency: result.invoice.currency,
        invoiceTotal: result.invoice.invoiceTotal,
        lineCount: result.lineCount,
      },
      meta,
    });
    await writeAuditLog({
      actorId: user?.id,
      action: "invoice.create",
      entityType: "invoice",
      entityId: result.invoice.id,
      afterData: {
        deliveryId: primaryDeliveryId,
        status: "DRAFT",
        invoiceTotal: result.invoice.invoiceTotal.toString(),
        lineCount: result.lineCount,
      },
      ...meta,
    });
  } catch {
    // 事件/审计失败不阻断主流程
  }

  return ok({ invoice: result.invoice, lineCount: result.lineCount }, undefined, 201);
}
