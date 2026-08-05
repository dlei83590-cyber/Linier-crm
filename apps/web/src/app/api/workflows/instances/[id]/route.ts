import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, clientIp, writeAuditLog } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/** GET /api/workflows/instances/:id（详情：定义/审批人/动作/历史） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "workflow-instance:view");
  if (denied) return denied;
  requestLog(request, user?.id, "workflow-instance.get");

  const { id } = await params;

  const instance = await prisma.workflowInstance.findFirst({
    where: { id, deletedAt: null },
    include: {
      definition: {
        select: {
          code: true,
          name: true,
          module: true,
          version: true,
          status: true,
          steps: {
            where: { deletedAt: null },
            orderBy: { stepNo: "asc" },
            include: { conditions: { where: { deletedAt: null } } },
          },
        },
      },
      approvers: {
        where: { deletedAt: null },
        orderBy: [{ stepNo: "asc" }, { createdAt: "asc" }],
      },
      actions: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
      },
      history: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!instance) {
    return failNotFound(ERROR_CODES.WORKFLOW_INSTANCE_NOT_FOUND, "审批实例不存在");
  }

  await writeAuditLog({
    actorId: user?.id,
    action: "workflow-instance.view",
    entityType: "workflow-instance",
    entityId: id,
    ipAddress: clientIp(request),
  });

  return ok(instance);
}
