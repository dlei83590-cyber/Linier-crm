import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, clientIp, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/workflows/definitions/:id/publish
 * 发布工作流定义：DRAFT → ACTIVE（要求至少一个有效步骤，发布后禁止修改关键结构）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "workflow-definition:approve");
  if (denied) return denied;
  requestLog(request, user?.id, "workflow-definition.publish");

  const { id } = await params;

  const definition = await prisma.workflowDefinition.findFirst({
    where: { id, deletedAt: null },
    include: {
      steps: { where: { deletedAt: null }, select: { id: true } },
    },
  });
  if (!definition) {
    return failNotFound(ERROR_CODES.WORKFLOW_DEFINITION_NOT_FOUND, "工作流定义不存在");
  }
  if (definition.status === "ACTIVE") {
    return failConflict(ERROR_CODES.WORKFLOW_DEFINITION_PUBLISHED, "工作流已发布");
  }
  if (definition.status === "ARCHIVED") {
    return failConflict(ERROR_CODES.WORKFLOW_DEFINITION_ARCHIVED, "已归档的工作流不可发布");
  }
  if (definition.steps.length === 0) {
    return failConflict(ERROR_CODES.WORKFLOW_DEFINITION_NO_STEPS, "工作流至少需要一个步骤才能发布");
  }

  const updated = await prisma.workflowDefinition.update({
    where: { id },
    data: { status: "ACTIVE", version: { increment: 1 }, updatedById: user!.id },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "workflow-definition.publish",
    entityType: "workflow-definition",
    entityId: id,
    ipAddress: clientIp(request),
    meta: { code: definition.code, version: updated.version },
  });

  return ok({ id, status: updated.status, version: updated.version });
}
