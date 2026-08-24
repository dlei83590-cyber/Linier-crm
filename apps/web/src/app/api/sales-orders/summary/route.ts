import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestLog } from "@/lib/api-helpers";
import { ok } from "@/lib/api/response";

export const dynamic = "force-dynamic";

/**
 * GET /api/sales-orders/summary —— 模块页仪表盘 KPI
 *
 * 只读聚合（同一 Prisma 模型 + 同一状态枚举，不建立平行业务真相）：
 * - total：未删除单据总数
 * - byStatus：按状态计数（status）
 * - amount：订单金额合计（头级 totalAmount，Decimal 字符串返回）
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "sales-order:view");
  if (denied) return denied;
  requestLog(request, user?.id, "sales-orders.summary");

  const [total, byStatus, salesOrderAgg] = await Promise.all([
    prisma.salesOrder.count({ where: { deletedAt: null } }),
    prisma.salesOrder.groupBy({
      by: ["status"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    prisma.salesOrder.aggregate({
      where: { deletedAt: null },
      _sum: { totalAmount: true },
    }),
  ]);

  return ok({
    total,
    byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
    amount:
      salesOrderAgg._sum.totalAmount == null
        ? undefined
        : { label: "订单金额", value: salesOrderAgg._sum.totalAmount.toString() },
  });
}
