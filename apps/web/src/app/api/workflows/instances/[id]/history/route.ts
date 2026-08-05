import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failNotFound, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/** GET /api/workflows/instances/:id/history（实例流转历史，分页） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "workflow-instance:view");
  if (denied) return denied;
  requestLog(request, user?.id, "workflow-instance.history");

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  const instance = await prisma.workflowInstance.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!instance) {
    return failNotFound(ERROR_CODES.WORKFLOW_INSTANCE_NOT_FOUND, "审批实例不存在");
  }

  const [total, items] = await Promise.all([
    prisma.workflowHistory.count({ where: { instanceId: id, deletedAt: null } }),
    prisma.workflowHistory.findMany({
      where: { instanceId: id, deletedAt: null },
      orderBy: { createdAt: "asc" },
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}
