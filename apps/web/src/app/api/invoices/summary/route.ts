import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { requestLog } from "@/lib/api/logger";
import { ok } from "@/lib/api/response";

export const dynamic = "force-dynamic";

/**
 * GET /api/invoices/summary —— 模块页仪表盘 KPI
 *
 * 只读聚合（同一 Prisma 模型 + 同一状态枚举，不建立平行业务真相）：
 * - total：未删除单据总数
 * - byStatus：按状态计数（status）
 * - amount：发票金额合计（头级 invoiceTotal，Decimal 字符串返回）
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "invoice:view");
  if (denied) return denied;
  requestLog(request, user?.id, "invoices.summary");

  const [total, byStatus, invoiceAgg] = await Promise.all([
    prisma.invoice.count({ where: { deletedAt: null } }),
    prisma.invoice.groupBy({
      by: ["status"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    prisma.invoice.aggregate({
      where: { deletedAt: null },
      _sum: { invoiceTotal: true },
    }),
  ]);

  return ok({
    total,
    byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
    amount:
      invoiceAgg._sum.invoiceTotal == null
        ? undefined
        : { label: "发票金额", value: invoiceAgg._sum.invoiceTotal.toString() },
  });
}
