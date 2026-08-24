import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestLog } from "@/lib/api-helpers";
import { ok } from "@/lib/api/response";

export const dynamic = "force-dynamic";

/**
 * GET /api/supplier-invoices/summary —— 模块页仪表盘 KPI
 *
 * 只读聚合（同一 Prisma 模型 + 同一状态枚举，不建立平行业务真相）：
 * - total：未删除单据总数
 * - byStatus：按状态计数（documentStatus）
 * - amount：发票金额合计（头级 grossAmount，Decimal 字符串返回）
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "supplier-invoice:view");
  if (denied) return denied;
  requestLog(request, user?.id, "supplier-invoices.summary");

  const [total, byStatus, supplierInvoiceAgg] = await Promise.all([
    prisma.supplierInvoice.count({ where: { deletedAt: null } }),
    prisma.supplierInvoice.groupBy({
      by: ["documentStatus"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    prisma.supplierInvoice.aggregate({
      where: { deletedAt: null },
      _sum: { grossAmount: true },
    }),
  ]);

  return ok({
    total,
    byStatus: Object.fromEntries(byStatus.map((g) => [g.documentStatus, g._count._all])),
    amount:
      supplierInvoiceAgg._sum.grossAmount == null
        ? undefined
        : { label: "发票金额", value: supplierInvoiceAgg._sum.grossAmount.toString() },
  });
}
