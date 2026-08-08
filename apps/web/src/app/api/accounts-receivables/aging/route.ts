import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok } from "@/lib/api/response";
import { requestLog } from "@/lib/api/logger";
import { computeArProjection } from "@/lib/accounts-receivable/projection";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts-receivables/aging（账龄分析：0-30 / 31-60 / 61-90 / 90+ 汇总）
 * CTO Review 97/100 必改①：agingBucket 不存库——读取时动态计算，只依赖 today/dueDate/balance，属 Projection。
 * 返回按账龄区间聚合的余额合计与记录数（仅未清余额 balance>0 计入账龄桶；已清记录归入 settled）。
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "accounts-receivable:view");
  if (denied) return denied;
  requestLog(request, user?.id, "accounts-receivable.aging");

  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get("customerId")?.trim();
  const currency = searchParams.get("currency")?.trim();
  const now = new Date();

  const where = {
    deletedAt: null,
    ...(customerId ? { customerId } : {}),
    ...(currency ? { currency } : {}),
  };

  const records = await prisma.accountsReceivable.findMany({
    where,
    select: {
      id: true,
      customerId: true,
      currency: true,
      dueDate: true,
      balanceAmount: true,
      status: true,
    },
  });

  const buckets: Record<string, { count: number; balance: number }> = {
    "0-30": { count: 0, balance: 0 },
    "31-60": { count: 0, balance: 0 },
    "61-90": { count: 0, balance: 0 },
    "90+": { count: 0, balance: 0 },
    settled: { count: 0, balance: 0 },
  };

  for (const ar of records) {
    const projection = computeArProjection(ar.status, ar.dueDate, ar.balanceAmount, now);
    const balance = Number(ar.balanceAmount);
    const key = projection.effectiveAgingBucket ?? (balance <= 0 ? "settled" : null);
    if (key && buckets[key]) {
      buckets[key].count += 1;
      buckets[key].balance += balance;
    }
  }

  const totalBalance = records.reduce((sum, ar) => sum + Number(ar.balanceAmount), 0);
  return ok({
    asOf: now.toISOString(),
    buckets,
    totalRecords: records.length,
    totalBalance,
  });
}
