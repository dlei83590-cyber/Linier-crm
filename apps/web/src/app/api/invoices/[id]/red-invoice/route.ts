import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound, failServer } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { createInvoiceRevision, createInvoiceSnapshot, latestInvoiceRevisionNo } from "@/lib/invoice/helpers";
import { publishInvoiceEvent } from "@/lib/invoice/events";

export const dynamic = "force-dynamic";

/**
 * POST /api/invoices/:id/red-invoice —— 从已 ISSUED 蓝字发票一键创建红字（负数）DRAFT 发票
 * 用户指令：销售发票应支持红冲。
 * 事务链路：
 *  1. FOR UPDATE 锁原票 + 校验：存在、status=ISSUED、非红字（R2/R6）
 *  2. R4 防超冲预检：Σ|已 ISSUED 红字| ≤ |原票|（已有全额红字则拒绝创建第二张，409）
 *  3. 复制原票 header（customer/currency/taxProfile/paymentTerm/dates）→ 新 Invoice DRAFT（code=null）
 *     redLetter=true + redInvoiceRefId=原票 id（R1 一致）；金额快照复制（正数；issue 时服务端按原票取反 R3）
 *  4. 复制行（金额快照复制，sourceDeliveryLineId 溯源；**不**回写 delivery 开票投影——红字不新增占用）
 *  5. Revision + CREATED Snapshot + AuditLog + InvoiceCreated（事务外）
 *  6. 前端跳转新草稿详情，issue 表单预填 redInvoiceRefId → 走既有红字 issue（R2/R4/R6 + R3 取反）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "invoice:create");
  if (denied) return denied;
  requestLog(request, user?.id, "invoice.red-invoice");

  const { id } = await params;
  const meta = requestMeta(request);

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. 锁原票
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "Invoice" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (locked.length === 0) return { error: "NOT_FOUND" as const };
      const original = await tx.invoice.findFirst({
        where: { id, deletedAt: null },
        include: { lines: { where: { deletedAt: null }, orderBy: { lineNo: "asc" } } },
      });
      if (!original) return { error: "NOT_FOUND" as const };
      if (original.status !== "ISSUED" || original.redLetter) {
        return { error: "REF_INVALID" as const, status: original.status };
      }

      // 2. R4 预检：已有已 ISSUED 红字（全额红冲语义 → 存在即拒绝第二张）
      const existingReds = await tx.invoice.count({
        where: { redInvoiceRefId: id, redLetter: true, status: "ISSUED", deletedAt: null },
      });
      if (existingReds > 0) {
        return { error: "OVERFLOW" as const, originalTotal: original.invoiceTotal.toString() };
      }

      // 3. 复制 header → 红字 DRAFT
      const now = new Date();
      const red = await tx.invoice.create({
        data: {
          deliveryId: original.deliveryId,
          salesOrderId: original.salesOrderId,
          customerId: original.customerId,
          status: "DRAFT",
          invoiceDate: original.invoiceDate,
          dueDate: original.dueDate,
          currency: original.currency,
          taxProfileId: original.taxProfileId,
          paymentTerm: original.paymentTerm,
          subtotal: original.subtotal,
          taxAmount: original.taxAmount,
          invoiceTotal: original.invoiceTotal,
          paidAmount: new Prisma.Decimal(0),
          balanceAmount: original.invoiceTotal,
          redLetter: true,
          redInvoiceRefId: original.id,
          remark: original.remark ? `红冲自 ${original.code ?? ""}：${original.remark}` : `红冲自 ${original.code ?? ""}`,
          createdById: user!.id,
          updatedById: user!.id,
        },
      });

      // 4. 复制行（金额快照复制；不回写 delivery 开票投影）
      for (const l of original.lines) {
        await tx.invoiceLine.create({
          data: {
            invoiceId: red.id,
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

      // 5. Revision + CREATED Snapshot
      const snapshotData = {
        invoiceId: red.id,
        code: null,
        status: "DRAFT",
        redLetter: true,
        redInvoiceRefId: original.id,
        originalCode: original.code,
        deliveryId: original.deliveryId,
        salesOrderId: original.salesOrderId,
        customerId: original.customerId,
        currency: original.currency,
        subtotal: original.subtotal.toString(),
        taxAmount: original.taxAmount.toString(),
        invoiceTotal: original.invoiceTotal.toString(),
        paidAmount: "0",
        balanceAmount: original.invoiceTotal.toString(),
        lines: original.lines.map((l) => ({
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
      await createInvoiceRevision(tx, red.id, "红字发票（红冲自 " + (original.code ?? "") + "）", snapshotData, user?.id);
      const revisionNo = await latestInvoiceRevisionNo(tx, red.id);
      const firstPs = original.lines[0]?.priceSnapshotId
        ? await tx.quotationPriceSnapshot.findFirst({ where: { id: original.lines[0].priceSnapshotId } })
        : null;
      await createInvoiceSnapshot(tx, red.id, "CREATED", revisionNo, snapshotData, user?.id, {
        taxProfileId: original.taxProfileId,
        taxRate: firstPs?.taxRate ?? null,
        sstNo: null,
        currencyRate: null,
        exchangeRate: firstPs?.exchangeRate ?? null,
      });

      return { invoice: red, originalCode: original.code ?? "" };
    });

    if ("error" in result) {
      switch (result.error) {
        case "NOT_FOUND":
          return failNotFound(ERROR_CODES.INVOICE_NOT_FOUND, "原票不存在");
        case "REF_INVALID":
          return failConflict(ERROR_CODES.RED_INVOICE_REF_STATUS_INVALID, `仅 ISSUED 蓝字发票可红冲（当前 status=${result.status}；红字禁止再红冲）`);
        case "OVERFLOW":
          return failConflict(ERROR_CODES.RED_INVOICE_OVERFLOW, `该蓝字发票已有红冲发票，禁止重复红冲（原票 ${result.originalTotal}）`);
      }
    }

    try {
      await publishInvoiceEvent({
        eventType: "InvoiceCreated",
        actorId: user?.id,
        entityId: result.invoice.id,
        payload: {
          invoiceId: result.invoice.id,
          invoiceCode: null,
          deliveryId: result.invoice.deliveryId,
          salesOrderId: result.invoice.salesOrderId,
          customerId: result.invoice.customerId,
          currency: result.invoice.currency,
          invoiceTotal: result.invoice.invoiceTotal,
          redLetter: true,
          redInvoiceRefId: id,
          originalCode: result.originalCode,
        },
        meta,
      });
      await writeAuditLog({
        actorId: user?.id,
        action: "invoice.red-invoice",
        entityType: "invoice",
        entityId: result.invoice.id,
        afterData: { originalInvoiceId: id, originalCode: result.originalCode },
        ...meta,
      });
    } catch (e) {
      console.error("[invoice.red-invoice] event/audit failed", e);
    }

    return ok({ id: result.invoice.id, originalInvoiceId: id, redLetter: true });
  } catch (e) {
    console.error("[invoice.red-invoice]", e);
    return failServer("创建红字发票失败");
  }
}
