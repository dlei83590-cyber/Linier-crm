import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { requestLog } from "@/lib/api/logger";
import { ok } from "@/lib/api/response";

export const dynamic = "force-dynamic";

/**
 * GET /api/quotations/summary —— 模块页仪表盘 KPI
 *
 * 只读聚合（同一 Prisma 模型 + 同一状态枚举，不建立平行业务真相）：
 * - total：未删除单据总数
 * - byStatus：按状态计数（status）
 * - amount：报价金额合计（头级 totalAmount，Decimal 字符串返回）
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "quotation:view");
  if (denied) return denied;
  requestLog(request, user?.id, "quotations.summary");

  const [total, byStatus, quotationAgg] = await Promise.all([
    prisma.quotation.count({ where: { deletedAt: null } }),
    prisma.quotation.groupBy({
      by: ["status"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    prisma.quotation.aggregate({
      where: { deletedAt: null },
      _sum: { totalAmount: true },
    }),
  ]);

  return ok({
    total,
    byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
    amount:
      quotationAgg._sum.totalAmount == null
        ? undefined
        : { label: "报价金额", value: quotationAgg._sum.totalAmount.toString() },
  });
}
