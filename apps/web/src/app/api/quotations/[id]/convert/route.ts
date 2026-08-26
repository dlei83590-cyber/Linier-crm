import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound, failServer } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { effectiveStatusOf } from "@/lib/quotation/helpers";
import { publishQuotationEvent } from "@/lib/quotation/events";
import { publishSalesOrderEvent } from "@/lib/sales-order/events";
import { nextSalesOrderCode } from "@/lib/sales-order/helpers";

export const dynamic = "force-dynamic";

/**
 * POST /api/quotations/:id/convert — Quotation → SalesOrder 唯一转换入口（Sprint 4B 正式实现，替换 4A 的 501）
 * 规则（CTO Sprint 4B 设计锁定）：
 *  - 前置校验：status=ACCEPTED、未过期（effectiveStatusOf）、未转换（convertedAt/salesOrderId 为空）
 *  - 并发安全（沿用 Opportunity Convert）：SELECT ... FOR UPDATE 真实行锁 → 原子取号 → 唯一约束（quotationId @unique）
 *    冲突（P2002）稳定转 409，不暴露 Prisma 原始错误
 *  - 事务：创建 SalesOrder（status=DRAFT）→ 复制有效 QuotationLine（继承商业价格 + priceSnapshotId，不重新定价）
 *    → 创建 SalesOrderSnapshot(CREATED) → 回写 Quotation（salesOrderId/convertedAt/convertedById/status=CONVERTED）
 *    → AuditLog → Domain Event（QuotationConverted + SalesOrderCreated）
 *  - 禁止通过自由 POST /api/sales-orders 模拟转换（Direct SO 本阶段不允许，quotationId 必填）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // convert 映射现有动作（CTO：新动作不破坏 RBAC 规范）
  const denied = requirePermission(user, "quotation:approve");
  if (denied) return denied;
  requestLog(request, user?.id, "quotation.convert");

  const { id } = await params;
  const meta = requestMeta(request);

  const result = await prisma.$transaction(async (tx) => {
    // ① 真实数据库行锁：SELECT ... FOR UPDATE 锁定 Quotation，串行化同一报价的并发转换
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "Quotation" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: "NOT_FOUND" as const };

    // ② 读取 Quotation（行已锁定）并校验：ACCEPTED / 未过期 / 未转换
    const quotation = await tx.quotation.findFirst({
      where: { id, deletedAt: null },
      include: { lines: { where: { deletedAt: null }, orderBy: { lineNo: "asc" } } },
    });
    if (!quotation) return { error: "NOT_FOUND" as const };
    if (quotation.status !== "ACCEPTED") {
      return { error: "INVALID_STATE" as const };
    }
    if (effectiveStatusOf(quotation).isExpired) {
      return { error: "EXPIRED" as const };
    }
    if (quotation.convertedAt || quotation.salesOrderId) {
      return { error: "ALREADY_CONVERTED" as const };
    }

    // ③ 原子取号（docType=SALES_ORDER；单据序列重构：SO-LNE{YYYY}{MM}{####}）
    const salesOrderCode = await nextSalesOrderCode(tx, new Date());

    // ④ 创建 SalesOrder（status=DRAFT；继承商业字段；Quotation 无 paymentTerm/incoterm 字段 → 置空待后续维护）
    const salesOrder = await tx.salesOrder.create({
      data: {
        code: salesOrderCode,
        quotationId: quotation.id,
        customerId: quotation.customerId,
        projectId: quotation.projectId,
        status: "DRAFT",
        orderDate: new Date(),
        currency: quotation.currency,
        exchangeRateSnapshot: quotation.exchangeRateSnapshot,
        taxProfileId: quotation.taxProfileId,
        subtotal: quotation.subtotal,
        taxAmount: quotation.taxAmount,
        totalAmount: quotation.totalAmount,
        remark: quotation.remark,
        createdById: user!.id,
        updatedById: user!.id,
      },
    });

    // ⑤ 复制有效 QuotationLine → SalesOrderLine（继承商业价格 + priceSnapshotId + 溯源；不重新定价）
    for (const line of quotation.lines) {
      await tx.salesOrderLine.create({
        data: {
          salesOrderId: salesOrder.id,
          sourceQuotationLineId: line.id,
          lineNo: line.lineNo,
          itemId: line.itemId,
          priceSnapshotId: line.priceSnapshotId,
          description: line.description,
          quantity: line.quantity,
          uomId: line.uomId,
          unitPrice: line.unitPrice,
          lineAmount: line.lineAmount,
          taxAmount: line.taxAmount,
          totalAmount: line.totalAmount,
          // Sprint 4C 交付投影初始化（CTO Review：remainingQty 初始 = ordered quantity；deliveredQty 初始 0）
          deliveredQty: new Prisma.Decimal(0),
          remainingQty: line.quantity,
          createdById: user!.id,
          updatedById: user!.id,
        },
      });
    }

    // ⑥ 创建 SalesOrderSnapshot(CREATED)（金额统一 Decimal 字符串，禁止 toNumber()）
    const revisionNo = await tx.salesOrderRevision.count({ where: { salesOrderId: salesOrder.id, deletedAt: null } });
    await tx.salesOrderSnapshot.create({
      data: {
        salesOrderId: salesOrder.id,
        snapshotType: "CREATED",
        revisionNo: Math.max(revisionNo, 1),
        snapshotData: {
          status: "DRAFT",
          quotationId: quotation.id,
          quotationCode: quotation.code,
          totalAmount: quotation.totalAmount.toString(),
          currency: quotation.currency,
          convertedBy: user!.id,
          convertedAt: new Date().toISOString(),
        },
        generatedById: user!.id,
        createdById: user!.id,
        updatedById: user!.id,
      },
    });

    // ⑦ 回写 Quotation：salesOrderId / convertedAt / convertedById / status=CONVERTED
    await tx.quotation.update({
      where: { id: quotation.id },
      data: {
        salesOrderId: salesOrder.id,
        convertedAt: new Date(),
        convertedById: user!.id,
        status: "CONVERTED",
        updatedById: user!.id,
      },
    });

    return { error: null as null, salesOrder, quotationCode: quotation.code };
  }).catch((err: unknown) => {
    // 并发兜底：唯一约束冲突（quotationId @unique / 编号冲突）稳定转 409，不暴露 Prisma P2002
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: "ALREADY_CONVERTED" as const };
    }
    throw err;
  });

  if (result.error === "NOT_FOUND") {
    return failNotFound(ERROR_CODES.QUOTATION_NOT_FOUND, "报价单不存在");
  }
  if (result.error === "INVALID_STATE") {
    return failConflict(ERROR_CODES.QUOTATION_INVALID_STATE, "仅 ACCEPTED 状态可转换 Sales Order");
  }
  if (result.error === "EXPIRED") {
    return failConflict(ERROR_CODES.QUOTATION_EXPIRED, "报价已过期，禁止转换");
  }
  if (result.error === "ALREADY_CONVERTED") {
    return failConflict(ERROR_CODES.QUOTATION_ALREADY_CONVERTED, "报价已转换，禁止重复转换");
  }
  if (!result.salesOrder) {
    return failServer("创建销售订单失败");
  }

  // ⑧ AuditLog
  await writeAuditLog({
    actorId: user?.id,
    action: "quotation.convert",
    entityType: "quotation",
    entityId: id,
    afterData: { salesOrderId: result.salesOrder.id, salesOrderCode: result.salesOrder.code },
    ...meta,
  });

  // ⑨ Domain Event：QuotationConverted + SalesOrderCreated（事件总线落地前以 AuditLog 留痕）
  await Promise.allSettled([
    publishQuotationEvent({
      eventType: "QuotationConverted",
      actorId: user?.id,
      entityId: id,
      payload: {
        quotationId: id,
        quotationCode: result.quotationCode,
        revisionNo: 1,
        customerId: result.salesOrder.customerId,
        projectId: result.salesOrder.projectId,
        workflowInstanceId: null,
        currency: result.salesOrder.currency,
        totalAmount: result.salesOrder.totalAmount,
        salesOrderId: result.salesOrder.id,
        convertedBy: user?.id,
      },
      meta,
    }),
    publishSalesOrderEvent({
      eventType: "SalesOrderCreated",
      actorId: user?.id,
      entityId: result.salesOrder.id,
      payload: {
        salesOrderId: result.salesOrder.id,
        salesOrderCode: result.salesOrder.code,
        quotationId: id,
        customerId: result.salesOrder.customerId,
        projectId: result.salesOrder.projectId,
        currency: result.salesOrder.currency,
        totalAmount: result.salesOrder.totalAmount,
        createdBy: user?.id,
      },
      meta,
    }),
  ]);

  return ok({
    salesOrder: {
      id: result.salesOrder.id,
      code: result.salesOrder.code,
      status: result.salesOrder.status,
      quotationId: id,
    },
    converted: true,
  });
}
