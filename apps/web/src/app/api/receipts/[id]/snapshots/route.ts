import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/** GET /api/receipts/:id/snapshots（快照历史，generatedAt desc；只读——固化节点生成） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "receipt-snapshot:view");
  if (denied) return denied;
  requestLog(request, user?.id, "receipt-snapshot.list");

  const { id } = await params;
  const receipt = await prisma.receipt.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!receipt) return failNotFound(ERROR_CODES.RECEIPT_NOT_FOUND, "收款单不存在");

  const snapshots = await prisma.receiptSnapshot.findMany({
    where: { receiptId: id, deletedAt: null },
    orderBy: { generatedAt: "desc" },
  });
  return ok(snapshots);
}
