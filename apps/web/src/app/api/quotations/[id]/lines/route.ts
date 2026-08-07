import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, fail } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { quotationLineCreateSchema } from "@/lib/api/schemas";
import { recalcQuotationTotals, createQuotationRevision } from "@/lib/quotation/helpers";
import { quotationPricingService, type QuotationPricingLineResult } from "@/lib/pricing/QuotationPricingService";
import { publishQuotationEvent } from "@/lib/quotation/events";

export const dynamic = "force-dynamic";

const EDITABLE_STATUSES = ["DRAFT", "REJECTED"] as const;

/** GET /api/quotations/:id/lines（行列表） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "quotation-line:view");
  if (denied) return denied;
  requestLog(request, user?.id, "quotation-line.list");

  const { id } = await params;
  const quotation = await prisma.quotation.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!quotation) return failNotFound(ERROR_CODES.QUOTATION_NOT_FOUND, "报价单不存在");

  const lines = await prisma.quotationLine.findMany({
    where: { quotationId: id, deletedAt: null },
    orderBy: { lineNo: "asc" },
    include: { item: { select: { id: true, code: true, name: true, model: true } }, priceSnapshot: true },
  });
  return ok(lines);
}

/**
 * POST /api/quotations/:id/lines（新增行，仅 DRAFT/REJECTED）
 * 价格红线（ADR-0015）：行价必须来自 PricingEngine.resolvePrice() → QuotationPriceSnapshot → priceSnapshotId，
 * 禁止前端直接决定 unitPrice。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "quotation-line:create");
  if (denied) return denied;
  requestLog(request, user?.id, "quotation-line.create");

  const { id } = await params;
  const parsed = quotationLineCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const data = parsed.data;
  const meta = requestMeta(request);

  const quotation = await prisma.quotation.findFirst({ where: { id, deletedAt: null } });
  if (!quotation) return failNotFound(ERROR_CODES.QUOTATION_NOT_FOUND, "报价单不存在");
  if ((EDITABLE_STATUSES as readonly string[]).includes(quotation.status) === false) {
    return failConflict(ERROR_CODES.QUOTATION_NOT_EDITABLE, "仅 DRAFT/REJECTED 状态可编辑行");
  }

  // ① 事务：创建占位行（价格 0，拿 lineId）
  let lineId: string;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const last = await tx.quotationLine.findFirst({
        where: { quotationId: id, deletedAt: null },
        orderBy: { lineNo: "desc" },
      });
      const lineNo = data.lineNo ?? (last ? last.lineNo + 10 : 10);
      const line = await tx.quotationLine.create({
        data: {
          quotationId: id,
          lineNo,
          itemId: data.itemId,
          description: data.description ?? "",
          quantity: new Prisma.Decimal(data.quantity),
          uomId: data.uomId ?? null,
          unitPrice: new Prisma.Decimal(0),
          lineAmount: new Prisma.Decimal(0),
          taxAmount: new Prisma.Decimal(0),
          totalAmount: new Prisma.Decimal(0),
          createdById: user!.id,
          updatedById: user!.id,
        },
      });
      return line;
    });
    lineId = created.id;
  } catch (e) {
    console.error("[quotation-line.create] tx failed:", e);
    return fail(ERROR_CODES.INTERNAL_ERROR, "新增报价行失败", 500);
  }

  // ② 事务外定价（QuotationPricingService 内部使用全局 prisma 创建快照）
  let pricing: QuotationPricingLineResult[];
  try {
    pricing = await quotationPricingService.priceLines({
      quotationId: id,
      customerId: quotation.customerId,
      currency: quotation.currency,
      pricingDate: new Date(),
      taxProfileId: quotation.taxProfileId ?? undefined,
      lines: [{ lineId, itemId: data.itemId, quantity: data.quantity, uom: data.uomId ?? undefined }],
    });
  } catch {
    await prisma.quotationLine.update({ where: { id: lineId }, data: { deletedAt: new Date() } }).catch(() => undefined);
    return fail(ERROR_CODES.QUOTATION_PRICE_FAILED, "报价定价失败：请检查物料价格配置", 400);
  }

  // ③ 事务：回写行价格 + 重算头合计 + Revision + 事件 + 审计
  const saved = await prisma.$transaction(async (tx) => {
    const r = pricing[0];
    await tx.quotationLine.update({
      where: { id: lineId },
      data: {
        priceSnapshotId: r.priceSnapshotId,
        unitPrice: r.unitPrice,
        lineAmount: r.lineAmount,
        taxAmount: r.taxAmount,
        totalAmount: r.totalAmount,
        updatedById: user!.id,
      },
    });
    const lines = await tx.quotationLine.findMany({ where: { quotationId: id, deletedAt: null }, orderBy: { lineNo: "asc" } });
    await recalcQuotationTotals(tx, id, lines);
    const q = await tx.quotation.findFirst({ where: { id } });
    if (q) await createQuotationRevision(tx, id, "新增报价行", { quotation: q, lines }, user?.id);
    const line = await tx.quotationLine.findFirst({ where: { id: lineId } });
    return { quotation: q, line };
  });

  await publishQuotationEvent({
    eventType: "QuotationUpdated",
    actorId: user?.id,
    entityId: id,
    payload: {
      quotationId: id,
      quotationCode: saved.quotation?.code ?? "",
      customerId: quotation.customerId,
      projectId: quotation.projectId,
      workflowInstanceId: quotation.workflowInstanceId,
      currency: quotation.currency,
      totalAmount: saved.quotation?.totalAmount,
    },
    meta,
  });
  await writeAuditLog({
    actorId: user?.id,
    action: "quotation-line.create",
    entityType: "quotationLine",
    entityId: lineId,
    afterData: { quotationId: id, itemId: data.itemId, quantity: data.quantity },
    ...meta,
  });

  return ok(saved.line, undefined, 201);
}
