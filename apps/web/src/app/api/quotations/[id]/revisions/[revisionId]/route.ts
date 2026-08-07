import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/quotations/:id/revisions/:revisionId（修订详情）
 * 只读；Revision 由系统生成（update/action 流程），不开放自由编辑。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; revisionId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "quotation-revision:view");
  if (denied) return denied;
  requestLog(request, user?.id, "quotation-revision.get");

  const { id, revisionId } = await params;
  const revision = await prisma.quotationRevision.findFirst({
    where: { id: revisionId, quotationId: id, deletedAt: null },
  });
  if (!revision) return failNotFound(ERROR_CODES.QUOTATION_NOT_FOUND, "修订记录不存在");

  return ok(revision);
}
