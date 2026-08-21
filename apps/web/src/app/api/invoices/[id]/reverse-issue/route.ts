import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { invoiceCancelSchema } from "@/lib/api/schemas";
import { createInvoiceSnapshot, latestInvoiceRevisionNo } from "@/lib/invoice/helpers";
import { publishInvoiceEvent } from "@/lib/invoice/events";
import { z } from "zod";

export const dynamic = "force-dynamic";

const reverseIssueSchema = z.object({
  changeReason: z.string().max(500).optional(),
});

/**
 * POST /api/invoices/:id/reverse-issue —— 反开票（撤销错误开票；用户指令 2026-08-21 红冲语义修正）
 * 红冲 = 反开票：对已 ISSUED 蓝票直接撤销（区别于红字发票——红字发票保留原票并生成冲销凭证）。
 * 前置：仅未收款（paidAmount=0）可撤销（有收款先冲销核销后再撤销）；红字发票禁止反开票。
 * 事务链路：
 *  1. FOR UPDATE 锁 Invoice（ISSUED 且非红字）
 *  2. 校验 paidAmount=0（未收款）；无未冲销核销（ReceiptAllocation reversedAt IS NULL）
 *  3. 软删 AccountsReceivable（deletedAt 置位；应收清零——原票作废后不再有应收事实）
 *  4. 读取 InvoiceLine（sourceDeliveryLineId/quantity），按 id ASC 锁 DeliveryLine，回滚开票投影：
 *     invoicedQty -= qty；remainingInvoiceQty += qty（释放可重新开票）
 *  5. status = CANCELLED + CANCELLED Snapshot（Decimal toString）
 *  6. AuditLog + InvoiceCancelled（事务外，事件失败不阻断）
 * 说明：撤销后原票可删除清理（CANCELLED 且无 AR → 现有 DELETE 允许）；不保留红字发票凭证。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "invoice:approve");
  if (denied) return denied;
  requestLog(request, user?.id, "invoice.reverse-issue");

  const { id } = await params;
  const parsed = reverseIssueSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { changeReason } = parsed.data;
  const meta = requestMeta(request);

  const result = await prisma.$transaction(async (tx) => {
    // 1. 锁 Invoice
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "Invoice" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: "NOT_FOUND" as const };
    const invoice = await tx.invoice.findFirst({
      where: { id, deletedAt: null },
      include: { lines: { where: { deletedAt: null }, orderBy: { lineNo: "asc" } } },
    });
    if (!invoice) return { error: "NOT_FOUND" as const };
    if (invoice.status !== "ISSUED") {
      return { error: "INVALID_STATE" as const, status: invoice.status };
    }
    if (invoice.redLetter) {
      return { error: "RED_FORBIDDEN" as const };
    }

    // 2. 仅未收款可撤销（有收款先冲销核销）
    if (invoice.paidAmount.greaterThan(0)) {
      return { error: "PAID_FORBIDDEN" as const, paidAmount: invoice.paidAmount.toString() };
    }
    const activeAllocs = await tx.receiptAllocation.count({
      where: { accountsReceivable: { invoiceId: id }, deletedAt: null, reversedAt: null },
    });
    if (activeAllocs > 0) {
      return { error: "ALLOC_EXISTS" as const, count: activeAllocs };
    }

    // 3. 软删 AR（应收清零——原票作废后不再有应收事实）
    const now = new Date();
    await tx.accountsReceivable.updateMany({
      where: { invoiceId: id, deletedAt: null },
      data: { deletedAt: now, isActive: false, updatedById: user!.id },
    });

    // 4. 回滚开票投影（invoicedQty -= qty；remainingInvoiceQty += qty）——释放可重新开票
    const deliveryLineIds = [
      ...new Set(invoice.lines.map((l) => l.sourceDeliveryLineId).filter((v): v is string => !!v)),
    ].sort();
    const dlMap = new Map<string, { id: string; invoicedQty: Prisma.Decimal; remainingInvoiceQty: Prisma.Decimal }>();
    for (const dlId of deliveryLineIds) {
      const dlLocked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "DeliveryLine" WHERE "id" = ${dlId} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (dlLocked.length > 0) {
        const dl = await tx.deliveryLine.findFirst({ where: { id: dlId, deletedAt: null } });
        if (dl) dlMap.set(dlId, dl);
      }
    }
    for (const line of invoice.lines) {
      if (!line.sourceDeliveryLineId) continue;
      const dl = dlMap.get(line.sourceDeliveryLineId);
      if (!dl) continue;
      await tx.deliveryLine.update({
        where: { id: dl.id },
        data: {
          invoicedQty: dl.invoicedQty.minus(line.quantity),
          remainingInvoiceQty: dl.remainingInvoiceQty.plus(line.quantity),
          updatedById: user!.id,
        },
      });
    }

    // 5. status = CANCELLED + Snapshot
    const updated = await tx.invoice.update({
      where: { id },
      data: { status: "CANCELLED", updatedById: user!.id, version: { increment: 1 } },
    });
    const revisionNo = await latestInvoiceRevisionNo(tx, id);
    await createInvoiceSnapshot(
      tx,
      id,
      "CANCELLED",
      revisionNo,
      {
        status: "CANCELLED",
        changeReason: changeReason ?? "反开票（撤销错误开票）",
        cancelledAt: now.toISOString(),
        cancelledById: user?.id,
        reverseIssue: true,
        originalCode: invoice.code,
        invoiceTotal: invoice.invoiceTotal.toString(),
        subtotal: invoice.subtotal.toString(),
        taxAmount: invoice.taxAmount.toString(),
        lines: invoice.lines.map((l) => ({
          lineId: l.id,
          sourceDeliveryLineId: l.sourceDeliveryLineId,
          quantity: l.quantity.toString(),
        })),
      },
      user?.id,
      {
        taxProfileId: invoice.taxProfileId,
        taxRate: null,
        sstNo: null,
        currencyRate: null,
        exchangeRate: null,
        invoiceType: invoice.invoiceType,
        taxInvoiceCode: invoice.taxInvoiceCode,
        taxInvoiceNo: invoice.taxInvoiceNo,
      },
    );

    return { invoice: updated, lineCount: invoice.lines.length };
  });

  if ("error" in result) {
    switch (result.error) {
      case "NOT_FOUND":
        return failNotFound(ERROR_CODES.INVOICE_NOT_FOUND, "发票不存在");
      case "INVALID_STATE":
        return failConflict(ERROR_CODES.INVOICE_INVALID_STATE, `仅已开票（ISSUED）蓝票可反开票撤销（当前 ${result.status}）`);
      case "RED_FORBIDDEN":
        return failConflict(ERROR_CODES.INVOICE_INVALID_STATE, "红字发票禁止反开票（红冲撤销 = 反开票仅用于蓝票）");
      case "PAID_FORBIDDEN":
        return failConflict(ERROR_CODES.INVOICE_INVALID_STATE, `发票已有收款（paidAmount=${result.paidAmount}），禁止反开票撤销（请先冲销核销）`);
      case "ALLOC_EXISTS":
        return failConflict(ERROR_CODES.INVOICE_INVALID_STATE, `发票仍有 ${result.count} 条未冲销核销记录，禁止反开票撤销（请先冲销核销）`);
    }
  }

  // 6. AuditLog + 事件（事务外）
  try {
    await publishInvoiceEvent({
      eventType: "InvoiceCancelled",
      actorId: user?.id,
      entityId: id,
      payload: {
        invoiceId: id,
        invoiceCode: result.invoice.code,
        deliveryId: result.invoice.deliveryId,
        salesOrderId: result.invoice.salesOrderId,
        customerId: result.invoice.customerId,
        currency: result.invoice.currency,
        invoiceTotal: result.invoice.invoiceTotal,
        changeReason: changeReason ?? "反开票（撤销错误开票）",
        reverseIssue: true,
        lineCount: result.lineCount,
      },
      meta,
    });
    await writeAuditLog({
      actorId: user?.id,
      action: "invoice.reverse-issue",
      entityType: "invoice",
      entityId: id,
      afterData: { code: result.invoice.code, status: "CANCELLED", changeReason: changeReason ?? "反开票（撤销错误开票）" },
      ...meta,
    });
  } catch (e) {
    console.error("[invoice.reverse-issue] event/audit failed", e);
  }

  return ok({ id, status: result.invoice.status });
}
