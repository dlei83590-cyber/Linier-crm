import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/** GET /api/quotations/:id/snapshots（关键状态快照列表，只读；快照全部由系统在固化节点生成） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "quotation-snapshot:view");
  if (denied) return denied;
  requestLog(request, user?.id, "quotation-snapshot.list");

  const { id } = await params;
  const quotation = await prisma.quotation.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!quotation) return failNotFound(ERROR_CODES.QUOTATION_NOT_FOUND, "报价单不存在");

  const snapshots = await prisma.quotationSnapshot.findMany({
    where: { quotationId: id, deletedAt: null },
    orderBy: { generatedAt: "desc" },
  });
  return ok(snapshots);
}
