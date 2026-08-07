import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok } from "@/lib/api/response";
import { parsePagination } from "@/lib/api/response";
import { requestLog } from "@/lib/api/logger";
import { computeArProjection } from "@/lib/accounts-receivable/projection";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts-receivables（分页 + customerId/status/effectiveStatus/currency/dueDateFrom/dueDateTo 过滤 + createdAt desc）
 * CTO Review 97/100：OVERDUE 为惰性投影（status ∈ {OPEN, PARTIALLY_PAID} 且 dueDate < now）；
 * effectiveAgingBucket 动态计算（0-30/31-60/61-90/90+），不持久化（必改①）。
 * 注意：不开放 POST/PATCH——AR 由 Invoice ISSUED 自动创建，金额只能由 4E-2/4E-3 动作驱动（CTO 锁定）。
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "accounts-receivable:view");
  if (denied) return denied;
  requestLog(request, user?.id, "accounts-receivable.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const customerId = searchParams.get("customerId")?.trim();
  const status = searchParams.get("status")?.trim();
  const effectiveStatus = searchParams.get("effectiveStatus")?.trim();
  const currency = searchParams.get("currency")?.trim();
  const dueDateFrom = searchParams.get("dueDateFrom")?.trim();
  const dueDateTo = searchParams.get("dueDateTo")?.trim();
  const now = new Date();

  // 基础过滤（数据库真实状态）
  const whereBase = {
    deletedAt: null,
    ...(customerId ? { customerId } : {}),
    ...(status ? { status: status as never } : {}),
    ...(currency ? { currency } : {}),
    ...(dueDateFrom || dueDateTo
      ? { dueDate: { ...(dueDateFrom ? { gte: new Date(dueDateFrom) } : {}), ...(dueDateTo ? { lte: new Date(dueDateTo) } : {}) } }
      : {}),
  };

  // effectiveStatus=OVERDUE → 惰性投影转换（不落库，查询时计算；CTO 拍板②）
  const where = {
    ...whereBase,
    ...(effectiveStatus === "OVERDUE"
      ? { status: { in: ["OPEN", "PARTIALLY_PAID"] as never }, dueDate: { lt: now } }
      : effectiveStatus
        ? { status: effectiveStatus as never }
        : {}),
  };

  const [total, items] = await Promise.all([
    prisma.accountsReceivable.count({ where }),
    prisma.accountsReceivable.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        customer: { select: { id: true, code: true, name: true } },
        invoice: { select: { id: true, code: true, status: true, invoiceTotal: true } },
      },
    }),
  ]);

  // 附加惰性投影字段（effectiveStatus/isOverdue/effectiveAgingBucket——必改① 动态计算）
  const data = items.map((ar) => {
    const projection = computeArProjection(ar.status, ar.dueDate, ar.balanceAmount, now);
    return { ...ar, ...projection };
  });

  return ok(data, { page, pageSize, total });
}
