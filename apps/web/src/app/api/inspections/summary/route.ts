import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { requestLog } from "@/lib/api/logger";
import { ok } from "@/lib/api/response";

export const dynamic = "force-dynamic";

/**
 * GET /api/inspections/summary —— 模块页仪表盘 KPI
 *
 * 只读聚合（同一 Prisma 模型 + 同一状态枚举，不建立平行业务真相）：
 * - total：未删除单据总数
 * - byStatus：按状态计数（result）
 * - amount：无（该单据无头级金额字段）
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "inspection:view");
  if (denied) return denied;
  requestLog(request, user?.id, "inspections.summary");

  const [total, byStatus] = await Promise.all([
    prisma.inspection.count({ where: { deletedAt: null } }),
    prisma.inspection.groupBy({
      by: ["result"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
  ]);

  return ok({
    total,
    byStatus: Object.fromEntries(byStatus.map((g) => [g.result, g._count._all])),
  });
}
