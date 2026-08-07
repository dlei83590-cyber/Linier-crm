import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/** GET /api/sales-orders/:id/revisions（修订历史，revisionNo desc；只读） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "sales-order-revision:view");
  if (denied) return denied;
  requestLog(request, user?.id, "sales-order-revision.list");

  const { id } = await params;
  const salesOrder = await prisma.salesOrder.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!salesOrder) return failNotFound(ERROR_CODES.SALES_ORDER_NOT_FOUND, "销售订单不存在");

  const revisions = await prisma.salesOrderRevision.findMany({
    where: { salesOrderId: id, deletedAt: null },
    orderBy: { revisionNo: "desc" },
  });
  return ok(revisions);
}
