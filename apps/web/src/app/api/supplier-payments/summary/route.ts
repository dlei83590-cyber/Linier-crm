import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestLog } from "@/lib/api-helpers";
import { ok } from "@/lib/api/response";

export const dynamic = "force-dynamic";

/**
 * GET /api/supplier-payments/summary —— 模块页仪表盘 KPI
 *
 * 只读聚合（同一 Prisma 模型 + 同一状态枚举，不建立平行业务真相）：
 * - total：未删除单据总数
 * - byStatus：按状态计数（status）
 * - amount：付款金额合计（头级 amount，Decimal 字符串返回）
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "supplier-payment:view");
  if (denied) return denied;
  requestLog(request, user?.id, "supplier-payments.summary");

  const [total, byStatus, supplierPaymentAgg] = await Promise.all([
    prisma.supplierPayment.count({ where: { deletedAt: null } }),
    prisma.supplierPayment.groupBy({
      by: ["status"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    prisma.supplierPayment.aggregate({
      where: { deletedAt: null },
      _sum: { amount: true },
    }),
  ]);

  return ok({
    total,
    byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
    amount:
      supplierPaymentAgg._sum.amount == null
        ? undefined
        : { label: "付款金额", value: supplierPaymentAgg._sum.amount.toString() },
  });
}
