import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, fail } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { salesOrderLineUpdateSchema } from "@/lib/api/schemas";
import { recalcSalesOrderTotals, createSalesOrderRevision } from "@/lib/sales-order/helpers";
import { maybeTriggerSalesOrderApproval } from "@/lib/sales-order/workflow-sync";
import { salesOrderPricingService, type SalesOrderPricingLineResult } from "@/lib/pricing/SalesOrderPricingService";
import { publishSalesOrderEvent } from "@/lib/sales-order/events";

export const dynamic = "force-dynamic";

const EDITABLE_STATUSES = ["DRAFT"] as const;

/**
 * PATCH /api/sales-orders/:id/lines/:lineId（仅 DRAFT；乐观锁 version）
 * CTO 锁定项②：SalesOrder 从已接受报价继承价格，只有商业条件变更（quantity/uomId）才允许重新定价。
 * 流程（对齐 Quotation Line 原子化 PATCH）：
 *  读取 SO → 校验可编辑状态 → 读取 Line → version 乐观锁 → nextQuantity/nextUomId
 *  → repricing 判断（quantity 或 uomId 变化）→ 先 PricingEngine（事务外）
 *  → Pricing 成功后进入单事务：更新 line（含新 priceSnapshotId）→ 重算 SO totals → 创建 SalesOrderRevision
 *  → AuditLog → SalesOrderUpdated event
 * 关键规则：定价失败不留半更新；正式价格不能由前端传 unitPrice（schema 无该字段）；
 * sourceQuotationLineId（溯源）永不清除；priceSnapshotId 重定价时更新为新快照；金额全程 Decimal。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; lineId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "sales-order-line:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "sales-order-line.update");

  const { id, lineId } = await params;
  const parsed = salesOrderLineUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version, changeReason, quantity, ...fields } = parsed.data;
  const meta = requestMeta(request);

  const salesOrder = await prisma.salesOrder.findFirst({ where: { id, deletedAt: null } });
  if (!salesOrder) return failNotFound(ERROR_CODES.SALES_ORDER_NOT_FOUND, "销售订单不存在");
  if ((EDITABLE_STATUSES as readonly string[]).includes(salesOrder.status) === false) {
    return failConflict(ERROR_CODES.SALES_ORDER_NOT_EDITABLE, "仅 DRAFT 状态可编辑行（CONFIRMED 后需走 amendment 流程）");
  }

  const line = await prisma.salesOrderLine.findFirst({ where: { id: lineId, salesOrderId: id, deletedAt: null } });
  if (!line) return failNotFound(ERROR_CODES.SALES_ORDER_LINE_NOT_FOUND, "销售订单行不存在");
  if (line.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const nextQuantity = quantity !== undefined ? new Prisma.Decimal(quantity) : line.quantity;
  const nextUomId = fields.uomId !== undefined ? fields.uomId : line.uomId;
  // 商业条件变更（quantity 或 uomId）→ 重新定价（ADR-0015：新快照，禁止手工填价）
  const repricing =
    (quantity !== undefined && !line.quantity.equals(nextQuantity)) ||
    (fields.uomId !== undefined && fields.uomId !== line.uomId);

  // ① 先定价（事务外；失败时数据库保持原状态，直接返回 400，不产生任何写入）
  // CTO Final Review 阻断项①：重定价必须走 SalesOrderPricingService（只调 PricingEngine.resolvePrice()），
  // 禁止复用 QuotationPricingService（否则会把 SalesOrderLine.id 误写成 quotationLineId 污染价格追溯）。
  let pricingResult: SalesOrderPricingLineResult | null = null;
  if (repricing) {
    try {
      const pricing = await salesOrderPricingService.priceLines({
        quotationId: salesOrder.quotationId,
        customerId: salesOrder.customerId,
        currency: salesOrder.currency,
        pricingDate: new Date(),
        taxProfileId: salesOrder.taxProfileId ?? undefined,
        lines: [{ lineId, itemId: line.itemId!, quantity: nextQuantity, uom: nextUomId ?? undefined }],
      });
      pricingResult = pricing[0];
    } catch {
      return fail(ERROR_CODES.SALES_ORDER_PRICE_FAILED, "销售订单行定价失败：请检查物料价格配置", 400);
    }
  }

  // ② 单事务：更新行（业务字段 + 定价回写，sourceQuotationLineId 溯源永不清除）→ 重算 SO totals → Revision
  //    → 审批触发（CTO Final Review 阻断项②/非阻断建议：商业修改与审批状态切换统一事务，命中策略失败整体回滚显式报错）
  let saved: { salesOrder: { id: string; code: string; totalAmount: unknown } | null; line: unknown };
  try {
    saved = await prisma.$transaction(async (tx) => {
      await tx.salesOrderLine.update({
        where: { id: lineId },
        data: {
          ...(fields.description !== undefined ? { description: fields.description } : {}),
          ...(fields.uomId !== undefined ? { uomId: fields.uomId } : {}),
          ...(fields.lineNo !== undefined ? { lineNo: fields.lineNo } : {}),
          ...(quantity !== undefined ? { quantity: nextQuantity } : {}),
          ...(pricingResult
            ? {
                priceSnapshotId: pricingResult.priceSnapshotId,
                unitPrice: pricingResult.unitPrice,
                lineAmount: pricingResult.lineAmount,
                taxAmount: pricingResult.taxAmount,
                totalAmount: pricingResult.totalAmount,
              }
            : {}),
          version: { increment: 1 },
          updatedById: user!.id,
        },
      });
      const lines = await tx.salesOrderLine.findMany({ where: { salesOrderId: id, deletedAt: null }, orderBy: { lineNo: "asc" } });
      await recalcSalesOrderTotals(tx, id, lines);
      const so = await tx.salesOrder.findFirst({ where: { id } });
      if (so) await createSalesOrderRevision(tx, id, changeReason ?? "更新销售订单行", { salesOrder: so, lines }, user?.id);
      // 审批触发（同一事务内，传 tx）：无实例创建 / RUNNING 保持 / 终态复用重新 SUBMIT；命中策略失败 → 抛错 → 整体回滚
      await maybeTriggerSalesOrderApproval({
        salesOrderId: id,
        keyCommercialChanged: repricing,
        actorId: user!.id,
        meta,
        tx,
      });
      const l = await tx.salesOrderLine.findFirst({ where: { id: lineId } });
      return { salesOrder: so, line: l };
    });
  } catch (e) {
    if (e instanceof Error && e.message === "WORKFLOW_DEFINITION_NOT_FOUND") {
      return fail(ERROR_CODES.SALES_ORDER_WORKFLOW_FAILED, "审批流程定义不存在或未发布（SALES_ORDER_APPROVAL），商业条件变更已回滚", 409);
    }
    throw e;
  }

  await publishSalesOrderEvent({
    eventType: "SalesOrderUpdated",
    actorId: user?.id,
    entityId: id,
    payload: {
      salesOrderId: id,
      salesOrderCode: saved.salesOrder?.code ?? "",
      quotationId: salesOrder.quotationId,
      customerId: salesOrder.customerId,
      projectId: salesOrder.projectId,
      currency: salesOrder.currency,
      totalAmount: saved.salesOrder?.totalAmount,
      changeReason: changeReason ?? "更新销售订单行",
    },
    meta,
  });
  // Sprint 4B Workflow 条件触发已移入主事务（CTO Final Review 阻断项②：与商业修改统一事务，失败整体回滚）

  await writeAuditLog({
    actorId: user?.id,
    action: "sales-order-line.update",
    entityType: "salesOrderLine",
    entityId: lineId,
    afterData: { salesOrderId: id, fields: Object.keys(fields), repricing },
    ...meta,
  });

  return ok(saved.line);
}
