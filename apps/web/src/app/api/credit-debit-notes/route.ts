import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, fail, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { creditDebitNoteCreateSchema } from "@/lib/api/schemas";
import { nextCreditDebitNoteCode, computeCreditDebitNoteTotal, validateCreditDebitNoteQuantity } from "@/lib/credit-debit-note/helpers";
import { publishCreditDebitNoteEvent } from "@/lib/credit-debit-note/events";

export const dynamic = "force-dynamic";

/**
 * POST /api/credit-debit-notes —— 创建 CreditDebitNote（DRAFT + Lines；单票制）
 * 校验（用户 #5533 Phase 3 指令 + CTO 98/100）：
 * ① `sourceInvoiceId` 必填且单票制；② 只接受已 **ISSUED** 的 Invoice（否则 409 CN_DN_SOURCE_INVOICE_INVALID）；
 * ③ Customer/Currency **从原 Invoice 继承**（禁止客户端传）；④ 所有 `sourceInvoiceLineId` 必须属于该 Invoice
 * （否则 409 CN_DN_SOURCE_LINE_INVALID）；⑤ 数量必须 > 0；⑥ 金额/税率/价格只复制原 InvoiceLine 快照，
 * **不调用 Pricing Engine**；⑦ 编号创建即取现有 CN/DN DocumentSequence（CN-/DN-2026-xxxx）；
 * ⑧ adjustmentTotal = Σ lines.totalAmount（服务端计算，禁止直传头金额）。
 * **Create 不做事实落账**：不创建 InvoiceAdjustment、不改 AR、不改 Invoice.balanceAmount
 * （事实由 Apply 事务生成——客户端禁直接创建事实）。
 * **累计防超调预检查**（软校验，最终强校验在 Apply）：CREDIT 按行聚合已 APPLIED 未撤销 Credit 数量，
 * remaining = 原行数量 - 累计已核销 Credit；本次数量超 remaining → 409 CN_DN_QUANTITY_EXCEEDED
 * （并发下只有 Apply 锁 Invoice/InvoiceLine/AR 才能保证两张 CN 不同时穿透）。
 * 事件：CreditDebitNoteCreated（AuditLog 留痕，失败降级不阻断主流程）
 */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "credit-debit-note:create");
  if (denied) return denied;
  requestLog(request, user?.id, "credit-debit-note.create");

  const parsed = creditDebitNoteCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { noteType, sourceInvoiceId, reason, lines, changeReason } = parsed.data;
  const meta = requestMeta(request);

  const result = await prisma.$transaction(async (tx) => {
    // 1. 校验源 Invoice：存在 + 已 ISSUED（单票制：sourceInvoiceId 单值，schema 层已保证）
    const invoice = await tx.invoice.findFirst({
      where: { id: sourceInvoiceId, deletedAt: null },
      select: { id: true, status: true, customerId: true, currency: true },
    });
    if (!invoice) return { error: "SOURCE_INVOICE_INVALID" as const, reason: "not-found" };
    if (invoice.status !== "ISSUED") {
      return { error: "SOURCE_INVOICE_INVALID" as const, reason: `status=${invoice.status}` };
    }

    // 2. 校验全部 sourceInvoiceLineId 属于该 Invoice + 取快照字段（不重算、不调 Pricing Engine）
    const lineIds = [...new Set(lines.map((l) => l.sourceInvoiceLineId))];
    const invoiceLines = await tx.invoiceLine.findMany({
      where: { id: { in: lineIds }, invoiceId: sourceInvoiceId, deletedAt: null },
      select: {
        id: true,
        itemId: true,
        description: true,
        quantity: true,
        uomId: true,
        unitPrice: true,
        discountRate: true,
        lineAmount: true,
        taxAmount: true,
        totalAmount: true,
      },
    });
    if (invoiceLines.length !== lineIds.length) {
      const found = new Set(invoiceLines.map((l) => l.id));
      const missing = lineIds.filter((id) => !found.has(id));
      return { error: "SOURCE_LINE_INVALID" as const, missingIds: missing };
    }
    const lineMap = new Map(invoiceLines.map((l) => [l.id, l]));

    // 3. 数量 > 0 校验 + 累计防超调预检查（CREDIT 软校验；最终强校验在 Apply）
    const lineData: Array<{
      sourceInvoiceLineId: string;
      quantity: Prisma.Decimal;
      itemId: string | null;
      description: string;
      uomId: string | null;
      unitPrice: Prisma.Decimal;
      discountRate: Prisma.Decimal;
      lineAmount: Prisma.Decimal;
      taxAmount: Prisma.Decimal;
      totalAmount: Prisma.Decimal;
    }> = [];

    for (const l of lines) {
      const src = lineMap.get(l.sourceInvoiceLineId)!;
      const qty = new Prisma.Decimal(l.quantity);
      const v = validateCreditDebitNoteQuantity(qty);
      if (!v.ok) return { error: "QUANTITY_INVALID" as const, lineId: l.sourceInvoiceLineId };

      if (noteType === "CREDIT") {
        // 预检查：剩余可调整数量 = 原行数量 - 已 APPLIED 未撤销 CREDIT 累计数量
        const agg = await tx.invoiceAdjustment.aggregate({
          where: {
            invoiceLineId: src.id,
            adjustmentType: "CREDIT",
            appliedAt: { not: null },
            reversedAt: null,
            deletedAt: null,
          },
          _sum: { quantity: true },
        });
        const appliedQty = agg._sum.quantity ?? new Prisma.Decimal(0);
        const remaining = new Prisma.Decimal(src.quantity).minus(appliedQty);
        if (qty.gt(remaining)) {
          return {
            error: "QUANTITY_EXCEEDED" as const,
            lineId: src.id,
            requested: qty.toString(),
            remaining: remaining.toString(),
          };
        }
      }

      // 金额快照直接复制原 InvoiceLine（unitPrice/discountRate/lineAmount/taxAmount/totalAmount）
      lineData.push({
        sourceInvoiceLineId: src.id,
        quantity: qty,
        itemId: src.itemId,
        description: src.description,
        uomId: src.uomId,
        unitPrice: src.unitPrice,
        discountRate: src.discountRate,
        lineAmount: src.lineAmount,
        taxAmount: src.taxAmount,
        totalAmount: src.totalAmount,
      });
    }

    // 4. 创建即取号（CN-/DN-2026-xxxx）+ adjustmentTotal = Σ lines（服务端计算）
    const code = await nextCreditDebitNoteCode(tx, noteType);
    const adjustmentTotal = computeCreditDebitNoteTotal(lineData);

    // 5. 创建 CreditDebitNote（DRAFT）+ Lines（Customer/Currency 从 Invoice 继承；不改 AR/Invoice）
    const created = await tx.creditDebitNote.create({
      data: {
        code,
        noteType,
        sourceInvoiceId,
        customerId: invoice.customerId,
        currency: invoice.currency,
        reason,
        adjustmentTotal,
        status: "DRAFT",
        createdById: user?.id ?? null,
        updatedById: user?.id ?? null,
        lines: {
          create: lineData.map((ld, idx) => ({
            sourceInvoiceLineId: ld.sourceInvoiceLineId,
            lineNo: (idx + 1) * 10,
            itemId: ld.itemId,
            description: ld.description,
            quantity: ld.quantity,
            uomId: ld.uomId,
            unitPrice: ld.unitPrice,
            discountRate: ld.discountRate,
            lineAmount: ld.lineAmount,
            taxAmount: ld.taxAmount,
            totalAmount: ld.totalAmount,
            createdById: user?.id ?? null,
            updatedById: user?.id ?? null,
          })),
        },
      },
      include: { lines: true },
    });
    return { note: created, customerId: invoice.customerId, currency: invoice.currency };
  });

  if ("error" in result) {
    switch (result.error) {
      case "SOURCE_INVOICE_INVALID":
        return failConflict(
          ERROR_CODES.CN_DN_SOURCE_INVOICE_INVALID,
          `源 Invoice 无效：必须为已 ISSUED 状态（${result.reason}）`,
        );
      case "SOURCE_LINE_INVALID":
        return failConflict(
          ERROR_CODES.CN_DN_SOURCE_LINE_INVALID,
          `存在不属于该 Invoice 的明细行（${result.missingIds.join(",")}）`,
        );
      case "QUANTITY_INVALID":
        return fail(ERROR_CODES.CN_DN_QUANTITY_EXCEEDED, `调整数量必须大于 0（行 ${result.lineId}）`, 400);
      case "QUANTITY_EXCEEDED":
        return failConflict(
          ERROR_CODES.CN_DN_QUANTITY_EXCEEDED,
          `调整数量超出剩余可调整数量（行 ${result.lineId}：requested=${result.requested}，remaining=${result.remaining}）`,
        );
      default:
        return fail(ERROR_CODES.INTERNAL_ERROR, "创建失败：未知错误", 500);
    }
  }

  // 6. 事件 + 审计（事务外，事件失败降级不阻断主流程）
  try {
    await publishCreditDebitNoteEvent({
      eventType: "CreditDebitNoteCreated",
      actorId: user?.id,
      entityId: result.note.id,
      payload: {
        noteId: result.note.id,
        noteCode: result.note.code,
        noteType: result.note.noteType,
        sourceInvoiceId: result.note.sourceInvoiceId,
        customerId: result.customerId,
        currency: result.currency,
        adjustmentTotal: result.note.adjustmentTotal,
        reason: result.note.reason,
        lineCount: result.note.lines.length,
      },
      meta,
    });
    await writeAuditLog({
      actorId: user?.id,
      action: "credit-debit-note.create",
      entityType: "credit-debit-note",
      entityId: result.note.id,
      afterData: {
        code: result.note.code,
        noteType: result.note.noteType,
        sourceInvoiceId: result.note.sourceInvoiceId,
        customerId: result.customerId,
        currency: result.currency,
        adjustmentTotal: result.note.adjustmentTotal.toString(),
        reason: result.note.reason,
        status: "DRAFT",
        lineCount: result.note.lines.length,
        ...(changeReason ? { changeReason } : {}),
      },
      ...meta,
    });
  } catch {
    // 事件/审计失败不阻断主流程（DB 事实已在事务内提交）
  }

  return ok({ creditDebitNote: result.note }, undefined, 201);
}

/**
 * GET /api/credit-debit-notes（分页 + status/noteType/customerId 过滤 + createdAt desc；只读）
 * 只读语义：CreditDebitNote 为独立事实，金额/状态由 submit/apply 事务驱动，无 PATCH。
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "credit-debit-note:view");
  if (denied) return denied;
  requestLog(request, user?.id, "credit-debit-note.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const status = searchParams.get("status")?.trim();
  const noteType = searchParams.get("noteType")?.trim();
  const customerId = searchParams.get("customerId")?.trim();

  const where = {
    deletedAt: null,
    ...(status ? { status: status as never } : {}),
    ...(noteType ? { noteType: noteType as never } : {}),
    ...(customerId ? { customerId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.creditDebitNote.count({ where }),
    prisma.creditDebitNote.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        sourceInvoice: { select: { id: true, code: true, invoiceTotal: true, balanceAmount: true } },
        lines: {
          where: { deletedAt: null },
          orderBy: { lineNo: "asc" },
        },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}
