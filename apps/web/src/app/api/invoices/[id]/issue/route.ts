import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { invoiceIssueSchema } from "@/lib/api/schemas";
import { nextInvoiceCode, createInvoiceSnapshot, latestInvoiceRevisionNo } from "@/lib/invoice/helpers";
import { publishInvoiceEvent } from "@/lib/invoice/events";

export const dynamic = "force-dynamic";

/**
 * POST /api/invoices/:id/issue（DRAFT → ISSUED；编号延后生成——CTO Review 必改①）
 * 事务链路（用户锁定）：
 *  1. FOR UPDATE 锁 Invoice（并发 issue 第二个请求在此被挡：status 已非 DRAFT → 409，不消耗第二个编号）
 *  2. 校验 status = DRAFT（仅 DRAFT 可开票；ISSUED+ 已开票或已取消 → 409）
 *  3. 校验至少 1 个有效 InvoiceLine
 *  4. 校验 invoiceTotal > 0
 *  5. 校验 code = null（DRAFT 不占号；若已有 code 说明已 ISSUED）
 *  6. DocumentSequence(INVOICE) 原子 increment → 生成正式 invoice code（如 INV-2026-000123）
 *  7. status = ISSUED + code 回写（issuedAt/issuedById 记录在 ISSUED Snapshot snapshotData，与 4C deliveredAt 同款）
 *  8. 创建 InvoiceSnapshot(ISSUED)（Decimal toString + 税务/汇率快照）
 *  9. AuditLog + InvoiceIssued（事务外，事件失败不阻断）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "invoice:approve");
  if (denied) return denied;
  requestLog(request, user?.id, "invoice.issue");

  const { id } = await params;
  const parsed = invoiceIssueSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { changeReason } = parsed.data;
  const meta = requestMeta(request);

  const result = await prisma.$transaction(async (tx) => {
    // ── 1. FOR UPDATE 锁 Invoice（并发 issue 串行化；第二个请求等待后读到 status=ISSUED → 409，不消耗编号） ──
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "Invoice" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: "NOT_FOUND" as const };

    const invoice = await tx.invoice.findFirst({
      where: { id, deletedAt: null },
      include: { lines: { where: { deletedAt: null }, orderBy: { lineNo: "asc" } } },
    });
    if (!invoice) return { error: "NOT_FOUND" as const };

    // ── 2. 校验 status = DRAFT ──────────────────────────────────────────────
    if (invoice.status !== "DRAFT") {
      return { error: "INVALID_STATE" as const, status: invoice.status };
    }
    // ── 3. 至少 1 个有效 InvoiceLine ────────────────────────────────────────
    if (invoice.lines.length === 0) return { error: "NO_LINES" as const };
    // ── 4. invoiceTotal > 0 ─────────────────────────────────────────────────
    if (invoice.invoiceTotal.lte(0)) return { error: "TOTAL_ZERO" as const };
    // ── 5. code = null（DRAFT 不占号；若已有 code 说明已 ISSUED） ───────────
    if (invoice.code !== null) return { error: "ALREADY_ISSUED" as const };

    // ── 6. DocumentSequence(INVOICE) 原子取号（编号延后生成，DRAFT 不消耗） ──
    const code = await nextInvoiceCode(tx);

    // ── 7. status = ISSUED + code 回写 ──────────────────────────────────────
    const updated = await tx.invoice.update({
      where: { id },
      data: {
        code,
        status: "ISSUED",
        updatedById: user!.id,
        version: { increment: 1 },
      },
    });

    // ── 8. InvoiceSnapshot(ISSUED)（issuedAt/issuedById 记录在 snapshotData；税务/汇率快照） ──
    const issuedAt = new Date();
    const revisionNo = await latestInvoiceRevisionNo(tx, id);
    const firstPs = invoice.lines[0]?.priceSnapshotId
      ? await tx.quotationPriceSnapshot.findFirst({ where: { id: invoice.lines[0].priceSnapshotId } })
      : null;
    await createInvoiceSnapshot(
      tx,
      id,
      "ISSUED",
      revisionNo,
      {
        code,
        issuedAt: issuedAt.toISOString(),
        issuedById: user?.id,
        status: "ISSUED",
        changeReason: changeReason ?? "对外开票",
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
        lines: invoice.lines.map((l) => ({
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

    return { invoice: updated, code, issuedAt };
  });

  if ("error" in result) {
    switch (result.error) {
      case "NOT_FOUND":
        return failNotFound(ERROR_CODES.INVOICE_NOT_FOUND, "发票不存在");
      case "INVALID_STATE":
        return failConflict(
          ERROR_CODES.INVOICE_INVALID_STATE,
          `仅 DRAFT 状态可开票（当前 ${result.status}；已开票/已取消禁止重复 issue）`,
        );
      case "NO_LINES":
        return failConflict(ERROR_CODES.INVOICE_INVALID_STATE, "发票至少需要 1 个有效行才能开票");
      case "TOTAL_ZERO":
        return failConflict(ERROR_CODES.INVOICE_INVALID_STATE, "发票金额必须大于 0 才能开票");
      case "ALREADY_ISSUED":
        return failConflict(ERROR_CODES.INVOICE_INVALID_STATE, "发票已生成编号，禁止重复开票（不消耗第二个编号）");
    }
  }

  // ── 9. 事件 + 审计（事务外，与现有模式一致；事件失败不阻断） ─────────────
  try {
    await publishInvoiceEvent({
      eventType: "InvoiceIssued",
      actorId: user?.id,
      entityId: id,
      payload: {
        invoiceId: id,
        invoiceCode: result.code,
        deliveryId: result.invoice.deliveryId,
        salesOrderId: result.invoice.salesOrderId,
        customerId: result.invoice.customerId,
        currency: result.invoice.currency,
        invoiceTotal: result.invoice.invoiceTotal,
        issuedAt: result.issuedAt.toISOString(),
        issuedById: user?.id,
      },
      meta,
    });
    await writeAuditLog({
      actorId: user?.id,
      action: "invoice.issue",
      entityType: "invoice",
      entityId: id,
      afterData: {
        code: result.code,
        status: "ISSUED",
        issuedAt: result.issuedAt.toISOString(),
        invoiceTotal: result.invoice.invoiceTotal.toString(),
      },
      ...meta,
    });
  } catch {
    // 事件/审计失败不阻断主流程
  }

  return ok({ invoice: result.invoice, code: result.code, issuedAt: result.issuedAt });
}
