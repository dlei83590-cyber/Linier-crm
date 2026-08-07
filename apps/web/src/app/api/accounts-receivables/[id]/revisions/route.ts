import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/** GET /api/accounts-receivables/:id/revisions（修订历史，revisionNo desc；只读——修订系统生成） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "accounts-receivable-revision:view");
  if (denied) return denied;
  requestLog(request, user?.id, "accounts-receivable-revision.list");

  const { id } = await params;
  const ar = await prisma.accountsReceivable.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!ar) return failNotFound(ERROR_CODES.ACCOUNTS_RECEIVABLE_NOT_FOUND, "应收记录不存在");

  const revisions = await prisma.accountsReceivableRevision.findMany({
    where: { accountsReceivableId: id, deletedAt: null },
    orderBy: { revisionNo: "desc" },
  });
  return ok(revisions);
}
