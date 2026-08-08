import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/receipts/:id（详情：Receipt + Customer 摘要 + allocations（含 AR 摘要）+ 最近 Revision/Snapshot）
 * 注意：无 PATCH——金额/状态为受控投影（拍板②），只能由 allocate/reversal/void 事务更新。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "receipt:view");
  if (denied) return denied;
  requestLog(request, user?.id, "receipt.get");

  const { id } = await params;
  const receipt = await prisma.receipt.findFirst({
    where: { id, deletedAt: null },
    include: {
      customer: { select: { id: true, code: true, name: true } },
      allocations: {
        where: { deletedAt: null },
        orderBy: { allocatedAt: "desc" },
        include: {
          accountsReceivable: {
            select: { id: true, invoiceId: true, balanceAmount: true, status: true },
          },
        },
      },
      revisions: { where: { deletedAt: null }, orderBy: { revisionNo: "desc" }, take: 1 },
      snapshots: { where: { deletedAt: null }, orderBy: { generatedAt: "desc" }, take: 1 },
    },
  });
  if (!receipt) return failNotFound(ERROR_CODES.RECEIPT_NOT_FOUND, "收款单不存在");
  return ok(receipt);
}
