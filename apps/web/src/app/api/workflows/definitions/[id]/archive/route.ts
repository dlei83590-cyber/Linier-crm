import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, clientIp, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/workflows/definitions/:id/archive
 * 归档工作流定义：ACTIVE → ARCHIVED（软停用，历史实例不受影响）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "workflow-definition:close");
  if (denied) return denied;
  requestLog(request, user?.id, "workflow-definition.archive");

  const { id } = await params;

  const definition = await prisma.workflowDefinition.findFirst({ where: { id, deletedAt: null } });
  if (!definition) {
    return failNotFound(ERROR_CODES.WORKFLOW_DEFINITION_NOT_FOUND, "工作流定义不存在");
  }
  if (definition.status === "ARCHIVED") {
    return failConflict(ERROR_CODES.WORKFLOW_DEFINITION_ARCHIVED, "工作流已归档");
  }
  if (definition.status === "DRAFT") {
    return failConflict(ERROR_CODES.WORKFLOW_DEFINITION_PUBLISHED, "草稿工作流无需归档，可直接删除");
  }

  const updated = await prisma.workflowDefinition.update({
    where: { id },
    data: { status: "ARCHIVED", isActive: false, version: { increment: 1 }, updatedById: user!.id },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "workflow-definition.archive",
    entityType: "workflow-definition",
    entityId: id,
    ipAddress: clientIp(request),
    meta: { code: definition.code, version: updated.version },
  });

  return ok({ id, status: updated.status, version: updated.version });
}
