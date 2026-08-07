import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/deliveries/:id/lines（行列表，含 item/uom/sourceSalesOrderLine 摘要；只读）
 * 原则上不开放 POST——交付行仅在创建 Delivery 时从 SO Line 选择（CTO 指示：分批发货，
 * 创建时明确传入指定行，不默认复制全部剩余行）；后续如需追加行再单独决策。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "delivery-line:view");
  if (denied) return denied;
  requestLog(request, user?.id, "delivery-line.list");

  const { id } = await params;
  const delivery = await prisma.delivery.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!delivery) return failNotFound(ERROR_CODES.DELIVERY_NOT_FOUND, "交付单不存在");

  const lines = await prisma.deliveryLine.findMany({
    where: { deliveryId: id, deletedAt: null },
    orderBy: { lineNo: "asc" },
    include: {
      item: { select: { id: true, code: true, name: true, model: true } },
      uom: { select: { id: true, code: true, name: true } },
      sourceSalesOrderLine: { select: { id: true, lineNo: true, quantity: true, deliveredQty: true, remainingQty: true } },
    },
  });
  return ok(lines);
}
