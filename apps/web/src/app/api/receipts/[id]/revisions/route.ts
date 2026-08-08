import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/** GET /api/receipts/:id/revisions（修订历史，revisionNo desc；只读——修订系统生成，禁止手工编辑） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "receipt-revision:view");
  if (denied) return denied;
  requestLog(request, user?.id, "receipt-revision.list");

  const { id } = await params;
  const receipt = await prisma.receipt.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!receipt) return failNotFound(ERROR_CODES.RECEIPT_NOT_FOUND, "收款单不存在");

  const revisions = await prisma.receiptRevision.findMany({
    where: { receiptId: id, deletedAt: null },
    orderBy: { revisionNo: "desc" },
  });
  return ok(revisions);
}
