import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, fail, failServer, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { quotationCreateSchema } from "@/lib/api/schemas";
import { nextQuotationCode, recalcQuotationTotals, createQuotationRevision, effectiveStatusOf } from "@/lib/quotation/helpers";
import { quotationPricingService, type QuotationPricingLineResult } from "@/lib/pricing/QuotationPricingService";
import { publishQuotationEvent } from "@/lib/quotation/events";

export const dynamic = "force-dynamic";

/** GET /api/quotations（分页 + code/customerId/status/dateFrom/dateTo 过滤 + createdAt desc 排序） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "quotation:view");
  if (denied) return denied;
  requestLog(request, user?.id, "quotation.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const customerId = searchParams.get("customerId")?.trim();
  const status = searchParams.get("status")?.trim();
  const dateFrom = searchParams.get("dateFrom")?.trim();
  const dateTo = searchParams.get("dateTo")?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code, mode: "insensitive" as const } } : {}),
    ...(customerId ? { customerId } : {}),
    ...(status ? { status: status as never } : {}),
    ...(dateFrom || dateTo
      ? { quoteDate: { ...(dateFrom ? { gte: new Date(dateFrom) } : {}), ...(dateTo ? { lte: new Date(dateTo) } : {}) } }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.quotation.count({ where }),
    prisma.quotation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        customer: { select: { id: true, code: true, name: true } },
        _count: { select: { lines: true } },
      },
    }),
  ]);

  const data = items.map((q) => ({ ...q, ...effectiveStatusOf(q) }));
  return ok(data, { page, pageSize, total });
}

/**
 * POST /api/quotations（创建报价草稿，Header + Lines 事务）
 * 价格红线（ADR-0015）：行价必须来自 PricingEngine.resolvePrice() → QuotationPriceSnapshot → QuotationLine.priceSnapshotId，
 * 禁止前端直接决定 unitPrice。创建时先落 header+lines 占位，事务外定价，再回写价格与汇总。
 */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "quotation:create");
  if (denied) return denied;
  requestLog(request, user?.id, "quotation.create");

  const parsed = quotationCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const data = parsed.data;
  const meta = requestMeta(request);

  // ① 事务：取号 + 创建 header + 占位 lines（拿 lineId 供定价回写）
  let quotationId: string;
  let code: string;
  let lineIds: Array<{ lineId: string; itemId: string; quantity: Prisma.Decimal; uomId: string | null }>;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const quotationCode = await nextQuotationCode(tx);
      const quotation = await tx.quotation.create({
        data: {
          code: quotationCode,
          customerId: data.customerId,
          opportunityId: data.opportunityId ?? null,
          projectId: data.projectId ?? null,
          status: "DRAFT",
          currency: data.currency,
          validFrom: data.validFrom ? new Date(data.validFrom) : null,
          validUntil: data.validUntil ? new Date(data.validUntil) : null,
          taxProfileId: data.taxProfileId ?? null,
          paymentTerm: data.paymentTerm ?? null,
          remark: data.remark ?? null,
          createdById: user!.id,
          updatedById: user!.id,
        },
      });
      const lines = [];
      for (const [idx, line] of data.lines.entries()) {
        const createdLine = await tx.quotationLine.create({
          data: {
            quotationId: quotation.id,
            lineNo: line.lineNo ?? (idx + 1) * 10,
            itemId: line.itemId,
            description: line.description ?? "",
            quantity: new Prisma.Decimal(line.quantity),
            uomId: line.uomId ?? null,
            unitPrice: new Prisma.Decimal(0),
            lineAmount: new Prisma.Decimal(0),
            taxAmount: new Prisma.Decimal(0),
            totalAmount: new Prisma.Decimal(0),
            createdById: user!.id,
            updatedById: user!.id,
          },
        });
        lines.push({ lineId: createdLine.id, itemId: line.itemId, quantity: createdLine.quantity, uomId: createdLine.uomId });
      }
      return { quotationId: quotation.id, code: quotationCode, lines };
    });
    quotationId = created.quotationId;
    code = created.code;
    lineIds = created.lines;
  } catch (e) {
    console.error("[quotation.create] tx failed:", e);
    return failServer("创建报价单失败");
  }

  // ② 事务外定价（QuotationPricingService 内部使用全局 prisma 创建快照）
  let pricing: QuotationPricingLineResult[];
  try {
    pricing = await quotationPricingService.priceLines({
      quotationId,
      customerId: data.customerId,
      currency: data.currency,
      pricingDate: new Date(),
      taxProfileId: data.taxProfileId ?? undefined,
      lines: lineIds.map((l) => ({ lineId: l.lineId, itemId: l.itemId, quantity: l.quantity, uom: l.uomId ?? undefined })),
    });
  } catch {
    // 定价失败：清理已创建的占位数据，返回价格错误（不暴露 Prisma 原始错误）
    await prisma.quotation
      .update({ where: { id: quotationId }, data: { deletedAt: new Date() } })
      .catch(() => undefined);
    return fail(ERROR_CODES.QUOTATION_PRICE_FAILED, "报价定价失败：请检查物料价格配置（PRICE_NOT_FOUND 等）", 400);
  }

  // ③ 事务：回写行价格 + 汇总 + Revision + 事件 + 审计
  const quotation = await prisma.$transaction(async (tx) => {
    for (const r of pricing) {
      await tx.quotationLine.update({
        where: { id: r.lineId },
        data: {
          priceSnapshotId: r.priceSnapshotId,
          unitPrice: r.unitPrice,
          lineAmount: r.lineAmount,
          taxAmount: r.taxAmount,
          totalAmount: r.totalAmount,
          updatedById: user!.id,
        },
      });
    }
    const lines = await tx.quotationLine.findMany({ where: { quotationId, deletedAt: null }, orderBy: { lineNo: "asc" } });
    await recalcQuotationTotals(tx, quotationId, lines);
    const saved = await tx.quotation.findFirst({ where: { id: quotationId } });
    if (saved) {
      await createQuotationRevision(tx, quotationId, "创建报价单", { quotation: saved, lines }, user?.id);
    }
    return saved;
  });

  if (!quotation) {
    return fail(ERROR_CODES.QUOTATION_NOT_FOUND, "报价单创建后读取失败", 500);
  }

  await publishQuotationEvent({
    eventType: "QuotationCreated",
    actorId: user?.id,
    entityId: quotationId,
    payload: {
      quotationId,
      quotationCode: code,
      revisionNo: 1,
      customerId: data.customerId,
      projectId: data.projectId ?? null,
      workflowInstanceId: null,
      currency: quotation.currency,
      totalAmount: quotation.totalAmount,
    },
    meta,
  });
  await writeAuditLog({
    actorId: user?.id,
    action: "quotation.create",
    entityType: "quotation",
    entityId: quotationId,
    afterData: { code, customerId: data.customerId, totalAmount: quotation.totalAmount },
    ...meta,
  });

  return ok({ ...quotation, ...effectiveStatusOf(quotation) }, undefined, 201);
}
