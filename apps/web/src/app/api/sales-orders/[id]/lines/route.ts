import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/sales-orders/:id/lines（行列表，含 item + priceSnapshot；只读）
 * 原则上不开放 POST——SO Line 来自 Quotation Convert（CTO 锁定项①）；
 * 如后续支持追加订单行再单独决策。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "sales-order-line:view");
  if (denied) return denied;
  requestLog(request, user?.id, "sales-order-line.list");

  const { id } = await params;
  const salesOrder = await prisma.salesOrder.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!salesOrder) return failNotFound(ERROR_CODES.SALES_ORDER_NOT_FOUND, "销售订单不存在");

  const lines = await prisma.salesOrderLine.findMany({
    where: { salesOrderId: id, deletedAt: null },
    orderBy: { lineNo: "asc" },
    include: { item: { select: { id: true, code: true, name: true, model: true } }, priceSnapshot: true },
  });
  return ok(lines);
}
