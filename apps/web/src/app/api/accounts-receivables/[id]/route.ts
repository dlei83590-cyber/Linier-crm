import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { computeArProjection } from "@/lib/accounts-receivable/projection";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts-receivables/:id（详情：AR + Invoice/Customer 摘要 + 最近 Revision/Snapshot）
 * CTO Review 97/100：effectiveStatus/effectiveAgingBucket 惰性投影，读取时计算不写库（必改①/拍板②）。
 * 注意：无 PATCH——AR 金额禁止前端直改（余额唯一口径，由 4E-2/4E-3 动作驱动）。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "accounts-receivable:view");
  if (denied) return denied;
  requestLog(request, user?.id, "accounts-receivable.get");

  const { id } = await params;
  const ar = await prisma.accountsReceivable.findFirst({
    where: { id, deletedAt: null },
    include: {
      customer: { select: { id: true, code: true, name: true } },
      invoice: {
        select: {
          id: true,
          code: true,
          status: true,
          invoiceDate: true,
          dueDate: true,
          invoiceTotal: true,
          paidAmount: true,
          balanceAmount: true,
          deliveryId: true,
          salesOrderId: true,
        },
      },
      revisions: { where: { deletedAt: null }, orderBy: { revisionNo: "desc" }, take: 1 },
      snapshots: { where: { deletedAt: null }, orderBy: { generatedAt: "desc" }, take: 1 },
    },
  });
  if (!ar) return failNotFound(ERROR_CODES.ACCOUNTS_RECEIVABLE_NOT_FOUND, "应收记录不存在");

  // 附加惰性投影字段（effectiveStatus/isOverdue/effectiveAgingBucket）
  const projection = computeArProjection(ar.status, ar.dueDate, ar.balanceAmount);
  return ok({ ...ar, ...projection });
}
