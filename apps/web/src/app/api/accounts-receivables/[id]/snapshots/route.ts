import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/** GET /api/accounts-receivables/:id/snapshots（快照列表，generatedAt desc；只读——快照全部由系统在固化节点生成） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "accounts-receivable-snapshot:view");
  if (denied) return denied;
  requestLog(request, user?.id, "accounts-receivable-snapshot.list");

  const { id } = await params;
  const ar = await prisma.accountsReceivable.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!ar) return failNotFound(ERROR_CODES.ACCOUNTS_RECEIVABLE_NOT_FOUND, "应收记录不存在");

  const snapshots = await prisma.accountsReceivableSnapshot.findMany({
    where: { accountsReceivableId: id, deletedAt: null },
    orderBy: { generatedAt: "desc" },
  });
  return ok(snapshots);
}
