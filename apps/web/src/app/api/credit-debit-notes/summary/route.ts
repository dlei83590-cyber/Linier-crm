import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestLog } from "@/lib/api-helpers";
import { ok } from "@/lib/api/response";

export const dynamic = "force-dynamic";

/**
 * GET /api/credit-debit-notes/summary —— 模块页仪表盘 KPI
 *
 * 只读聚合（同一 Prisma 模型 + 同一状态枚举，不建立平行业务真相）：
 * - total：未删除单据总数
 * - byStatus：按状态计数（status）
 * - amount：调整金额合计（头级 adjustmentTotal，Decimal 字符串返回）
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "credit-debit-note:view");
  if (denied) return denied;
  requestLog(request, user?.id, "credit-debit-notes.summary");

  const [total, byStatus, creditDebitNoteAgg] = await Promise.all([
    prisma.creditDebitNote.count({ where: { deletedAt: null } }),
    prisma.creditDebitNote.groupBy({
      by: ["status"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    prisma.creditDebitNote.aggregate({
      where: { deletedAt: null },
      _sum: { adjustmentTotal: true },
    }),
  ]);

  return ok({
    total,
    byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
    amount:
      creditDebitNoteAgg._sum.adjustmentTotal == null
        ? undefined
        : { label: "调整金额", value: creditDebitNoteAgg._sum.adjustmentTotal.toString() },
  });
}
