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

export const dynamic = "force-dynamic";

/**
 * POST /api/invoices/:id/cancel（仅 DRAFT → CANCELLED；ISSUED+ 禁止直接取消，后续走 Credit Note）
 * 事务链路（用户锁定顺序）：
 *  1. FOR UPDATE 锁 Invoice
 *  2. 校验 status = DRAFT（仅 DRAFT 可取消；ISSUED+ → 409 INVOICE_INVALID_STATE）
 *  3. 读取 InvoiceLine（含 sourceDeliveryLineId / quantity）
 *  4. 按 id ASC 锁涉及的 DeliveryLine（FOR UPDATE，防死锁）
 *  5. 回滚开票投影：invoicedQty -= qty；remainingInvoiceQty += qty
 *     （否则 Draft 取消后 DeliveryLine 永久显示"已开票"——本阶段最易遗漏的业务一致性点）
 *  6. status = CANCELLED
 *  7. 创建 CANCELLED Snapshot（Decimal toString + 税务/汇率快照）
 *  8. AuditLog + InvoiceCancelled（事务外，事件失败不阻断）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "invoice:close");
  if (denied) return denied;
  requestLog(request, user?.id, "invoice.cancel");

  const { id } = await params;
  const parsed = invoiceCancelSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { changeReason } = parsed.data;
  const meta = requestMeta(request);

  const result = await prisma.$transaction(async (tx) => {
    // ── 1. FOR UPDATE 锁 Invoice ────────────────────────────────────────────
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "Invoice" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: "NOT_FOUND" as const };

    const invoice = await tx.invoice.findFirst({
      where: { id, deletedAt: null },
      include: { lines: { where: { deletedAt: null }, orderBy: { lineNo: "asc" } } },
    });
    if (!invoice) return { error: "NOT_FOUND" as const };

    // ── 2. 校验 status = DRAFT（仅 DRAFT 可取消；ISSUED+ 走 Credit Note） ────
    if (invoice.status !== "DRAFT") {
      return { error: "INVALID_STATE" as const, status: invoice.status };
    }

    // ── 3. 读取 InvoiceLine（含 sourceDeliveryLineId / quantity） ────────────
    const invoiceLines = invoice.lines;
    if (invoiceLines.length === 0) {
      // 无行也允许取消（空 DRAFT 直接取消），但无可回滚投影
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
          changeReason: changeReason ?? "取消草稿发票",
          cancelledAt: new Date().toISOString(),
          cancelledById: user?.id,
          code: invoice.code,
          invoiceDate: updated.invoiceDate.toISOString(),
          dueDate: updated.dueDate?.toISOString() ?? null,
          currency: updated.currency,
          taxProfileId: updated.taxProfileId,
          paymentTerm: updated.paymentTerm,
          subtotal: updated.subtotal.toString(),
          taxAmount: updated.taxAmount.toString(),
          invoiceTotal: updated.invoiceTotal.toString(),
          paidAmount: updated.paidAmount.toString(),
          balanceAmount: updated.balanceAmount.toString(),
          lines: [],
        },
        user?.id,
        {
          taxProfileId: updated.taxProfileId,
          taxRate: null,
          sstNo: null,
          currencyRate: null,
          exchangeRate: null,
        },
      );
      return { invoice: updated, releasedLines: 0 };
    }

    // ── 4. 按 id ASC 锁涉及的 DeliveryLine（FOR UPDATE，防死锁） ─────────────
    const deliveryLineIds = [...new Set(invoiceLines.map((l) => l.sourceDeliveryLineId).filter((v): v is string => !!v))].sort();
    const dlMap = new Map<string, { id: string; invoicedQty: Prisma.Decimal; remainingInvoiceQty: Prisma.Decimal }>();
    for (const dlId of deliveryLineIds) {
      const lockedDl = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "DeliveryLine" WHERE "id" = ${dlId} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (lockedDl.length === 0) continue; // 源行已软删则跳过（投影已随行删除，无回滚目标）
      const dl = await tx.deliveryLine.findFirst({ where: { id: dlId, deletedAt: null } });
      if (!dl) continue;
      dlMap.set(dlId, { id: dl.id, invoicedQty: dl.invoicedQty, remainingInvoiceQty: dl.remainingInvoiceQty });
    }

    // ── 5. 回滚开票投影：invoicedQty -= qty；remainingInvoiceQty += qty ──────
    const releasedMap = new Map<string, Prisma.Decimal>();
    for (const line of invoiceLines) {
      if (!line.sourceDeliveryLineId) continue;
      const dl = dlMap.get(line.sourceDeliveryLineId);
      if (!dl) continue;
      const released = (releasedMap.get(dl.id) ?? new Prisma.Decimal(0)).plus(line.quantity);
      releasedMap.set(dl.id, released);
    }
    for (const [dlId, releasedQty] of releasedMap) {
      const dl = dlMap.get(dlId)!;
      await tx.deliveryLine.update({
        where: { id: dlId },
        data: {
          invoicedQty: dl.invoicedQty.minus(releasedQty),
          remainingInvoiceQty: dl.remainingInvoiceQty.plus(releasedQty),
          updatedById: user!.id,
        },
      });
    }

    // ── 6. status = CANCELLED ────────────────────────────────────────────────
    const updated = await tx.invoice.update({
      where: { id },
      data: { status: "CANCELLED", updatedById: user!.id, version: { increment: 1 } },
    });

    // ── 7. CANCELLED Snapshot（Decimal toString；税务/汇率快照） ──────────────
    const revisionNo = await latestInvoiceRevisionNo(tx, id);
    const firstPs = invoiceLines[0]?.priceSnapshotId
      ? await tx.quotationPriceSnapshot.findFirst({ where: { id: invoiceLines[0].priceSnapshotId } })
      : null;
    await createInvoiceSnapshot(
      tx,
      id,
      "CANCELLED",
      revisionNo,
      {
        status: "CANCELLED",
        changeReason: changeReason ?? "取消草稿发票",
        cancelledAt: new Date().toISOString(),
        cancelledById: user?.id,
        code: invoice.code,
        invoiceDate: updated.invoiceDate.toISOString(),
        dueDate: updated.dueDate?.toISOString() ?? null,
        currency: updated.currency,
        taxProfileId: updated.taxProfileId,
        paymentTerm: updated.paymentTerm,
        subtotal: updated.subtotal.toString(),
        taxAmount: updated.taxAmount.toString(),
        invoiceTotal: updated.invoiceTotal.toString(),
        paidAmount: updated.paidAmount.toString(),
        balanceAmount: updated.balanceAmount.toString(),
        lines: invoiceLines.map((l) => ({
          lineId: l.id,
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
      },
      user?.id,
      {
        taxProfileId: updated.taxProfileId,
        taxRate: firstPs?.taxRate ?? null,
        sstNo: null, // SST 注册号（TaxProfile 无此字段，待配置来源）
        currencyRate: null, // 汇率快照（待币种汇率配置；4E 前可扩展）
        exchangeRate: firstPs?.exchangeRate ?? null,
      },
    );

    return { invoice: updated, releasedLines: releasedMap.size };
  });

  if ("error" in result) {
    switch (result.error) {
      case "NOT_FOUND":
        return failNotFound(ERROR_CODES.INVOICE_NOT_FOUND, "发票不存在");
      case "INVALID_STATE":
        return failConflict(
          ERROR_CODES.INVOICE_INVALID_STATE,
          `仅 DRAFT 状态可取消（当前 ${result.status}；ISSUED+ 禁止直接取消，后续走 Credit Note）`,
        );
    }
  }

  // ── 8. 事件 + 审计（事务外，与现有模式一致；事件失败不阻断） ─────────────
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
        cancelledAt: new Date().toISOString(),
        cancelledById: user?.id,
        releasedDeliveryLines: result.releasedLines,
      },
      meta,
    });
    await writeAuditLog({
      actorId: user?.id,
      action: "invoice.cancel",
      entityType: "invoice",
      entityId: id,
      afterData: {
        status: "CANCELLED",
        releasedDeliveryLines: result.releasedLines,
        invoiceTotal: result.invoice.invoiceTotal.toString(),
      },
      ...meta,
    });
  } catch {
    // 事件/审计失败不阻断主流程
  }

  return ok({ invoice: result.invoice, releasedDeliveryLines: result.releasedLines });
}
