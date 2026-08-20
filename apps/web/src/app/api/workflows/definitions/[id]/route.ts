import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { casUpdate } from "@/lib/api/cas";
import { authenticate, requirePermission, clientIp, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { workflowDefinitionUpdateSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

/** 加载未删除的工作流定义（含步骤与条件） */
async function loadDefinition(id: string) {
  return prisma.workflowDefinition.findFirst({
    where: { id, deletedAt: null },
    include: {
      steps: {
        where: { deletedAt: null },
        orderBy: { stepNo: "asc" },
        include: { conditions: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } } },
      },
    },
  });
}

/** GET /api/workflows/definitions/:id */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "workflow-definition:view");
  if (denied) return denied;
  requestLog(request, user?.id, "workflow-definition.get");

  const { id } = await params;
  const definition = await loadDefinition(id);
  if (!definition) {
    return failNotFound(ERROR_CODES.WORKFLOW_DEFINITION_NOT_FOUND, "工作流定义不存在");
  }
  return ok(definition);
}

/** PATCH /api/workflows/definitions/:id（乐观锁 version；发布后禁止修改关键结构） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "workflow-definition:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "workflow-definition.update");

  const { id } = await params;
  const parsed = workflowDefinitionUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, steps, ...updates } = parsed.data;

  const existing = await prisma.workflowDefinition.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    return failNotFound(ERROR_CODES.WORKFLOW_DEFINITION_NOT_FOUND, "工作流定义不存在");
  }
  // 发布/归档后禁止修改关键结构（code/module/steps）
  if (existing.status !== "DRAFT" && (updates.code || updates.module || steps)) {
    return failConflict(
      ERROR_CODES.WORKFLOW_DEFINITION_PUBLISHED,
      "已发布/归档的工作流禁止修改 code/module/steps，请创建新版本",
    );
  }

  // A4-CAS：原子乐观锁置于事务首部（头部字段 CAS；steps 整体替换紧随其后，不再二次 bump version）
  const txResult = await prisma.$transaction(async (tx) => {
    const cas = await casUpdate(tx, "workflowDefinition", id, version, {
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.description !== undefined ? { description: updates.description } : {}),
      ...(updates.code !== undefined ? { code: updates.code } : {}),
      ...(updates.module !== undefined ? { module: updates.module } : {}),
      updatedById: user!.id,
    });
    if (cas.outcome !== "OK") return cas;
    const wf = await tx.workflowDefinition.update({
      where: { id },
      data: steps
        ? {
            steps: {
              deleteMany: {},
              create: steps.map((s) => ({
                stepNo: s.stepNo,
                stepName: s.stepName,
                approverType: s.approverType,
                approverValue: s.approverValue ?? null,
                approvalMode: s.approvalMode,
                timeoutHours: s.timeoutHours ?? null,
                allowReject: s.allowReject,
                allowTransfer: s.allowTransfer,
                allowDelegate: s.allowDelegate,
                allowWithdraw: s.allowWithdraw,
                createdById: user!.id,
                updatedById: user!.id,
                conditions: {
                  create: s.conditions.map((c) => ({
                    expression: c.expression ?? null,
                    field: c.field,
                    operator: c.operator,
                    value: c.value,
                    createdById: user!.id,
                    updatedById: user!.id,
                  })),
                },
              })),
            },
          }
        : {},
    });
    return { outcome: "OK" as const, wf };
  });
  if (txResult.outcome === "NOT_FOUND") {
    return failNotFound(ERROR_CODES.WORKFLOW_DEFINITION_NOT_FOUND, "工作流定义不存在");
  }
  if (txResult.outcome === "CONFLICT") {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }
  const updated = txResult.wf;

  const result = await loadDefinition(updated.id);

  await writeAuditLog({
    actorId: user?.id,
    action: "workflow-definition.update",
    entityType: "workflow-definition",
    entityId: id,
    ipAddress: clientIp(request),
    meta: { version: updated.version },
  });

  return ok(result);
}

/** DELETE /api/workflows/definitions/:id（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "workflow-definition:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "workflow-definition.delete");

  const { id } = await params;

  const result = await prisma.workflowDefinition.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });
  if (result.count === 0) {
    return failNotFound(ERROR_CODES.WORKFLOW_DEFINITION_NOT_FOUND, "工作流定义不存在");
  }

  await writeAuditLog({
    actorId: user?.id,
    action: "workflow-definition.delete",
    entityType: "workflow-definition",
    entityId: id,
    ipAddress: clientIp(request),
  });

  return ok({ id, deleted: true });
}
