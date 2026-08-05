import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, clientIp, writeAuditLog } from "@/lib/api-helpers";
import { ok, fail, failValidation, failConflict, failNotFound, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { workflowInstanceCreateSchema } from "@/lib/api/schemas";
import { resolveStepApprovers } from "@/lib/workflow/engine";

export const dynamic = "force-dynamic";

/** GET /api/workflows/instances（分页 + businessType/businessId/status/definitionId 过滤 + 软删除过滤） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "workflow-instance:view");
  if (denied) return denied;
  requestLog(request, user?.id, "workflow-instance.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const businessType = searchParams.get("businessType")?.trim();
  const businessId = searchParams.get("businessId")?.trim();
  const status = searchParams.get("status")?.trim();
  const definitionId = searchParams.get("definitionId")?.trim();
  const startedBy = searchParams.get("startedBy")?.trim();

  const where = {
    deletedAt: null,
    ...(businessType ? { businessType } : {}),
    ...(businessId ? { businessId } : {}),
    ...(status ? { status } : {}),
    ...(definitionId ? { definitionId } : {}),
    ...(startedBy ? { startedBy } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.workflowInstance.count({ where }),
    prisma.workflowInstance.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        definition: { select: { code: true, name: true, module: true, version: true } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/**
 * POST /api/workflows/instances
 * 创建实例：基于已发布(ACTIVE)定义，按步骤条件评估生成首批审批人，事务写入。
 */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "workflow-instance:create");
  if (denied) return denied;
  requestLog(request, user?.id, "workflow-instance.create");

  const parsed = workflowInstanceCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { definitionId, businessType, businessId, payload } = parsed.data;

  const instance = await prisma.$transaction(async (tx) => {
    const definition = await tx.workflowDefinition.findFirst({
      where: { id: definitionId, deletedAt: null, status: "ACTIVE" },
      include: {
        steps: {
          where: { deletedAt: null },
          orderBy: { stepNo: "asc" },
          include: { conditions: { where: { deletedAt: null } } },
        },
      },
    });
    if (!definition) {
      throw new Error(ERROR_CODES.WORKFLOW_DEFINITION_NOT_FOUND);
    }

    const dup = await tx.workflowInstance.findFirst({
      where: { businessType, businessId, deletedAt: null },
      select: { id: true },
    });
    if (dup) {
      throw new Error(ERROR_CODES.WORKFLOW_INSTANCE_EXISTS);
    }

    // 生成第一步审批人（条件评估：不满足条件的步骤跳过）
    const firstStep = definition.steps[0];
    const startStepNo = firstStep?.stepNo ?? 1;

    const created = await tx.workflowInstance.create({
      data: {
        definitionId,
        businessType,
        businessId,
        currentStepNo: startStepNo,
        startedBy: user!.id,
        status: "RUNNING",
        createdById: user!.id,
        updatedById: user!.id,
        actions: {
          create: {
            actionType: "SUBMIT",
            actorId: user!.id,
            stepNo: startStepNo,
            comment: "提交审批",
            createdById: user!.id,
            updatedById: user!.id,
          },
        },
        history: {
          create: {
            stepNo: startStepNo,
            actionType: "SUBMIT",
            beforeStatus: null,
            afterStatus: "RUNNING",
            actorId: user!.id,
            ip: clientIp(request) ?? null,
            device: null,
            browser: null,
            remark: "提交审批",
            createdById: user!.id,
            updatedById: user!.id,
          },
        },
      },
    });

    if (firstStep) {
      const userIds = await resolveStepApprovers(tx, firstStep.approverType, firstStep.approverValue);
      if (userIds.length > 0) {
        await tx.approver.createMany({
          data: userIds.map((uid) => ({
            instanceId: created.id,
            stepNo: firstStep.stepNo,
            userId: uid,
            status: "PENDING",
            createdById: user!.id,
            updatedById: user!.id,
          })),
        });
      }
    }

    return created;
  }).catch((e: Error) => {
    if (e.message === ERROR_CODES.WORKFLOW_DEFINITION_NOT_FOUND) {
      return failNotFound(ERROR_CODES.WORKFLOW_DEFINITION_NOT_FOUND, "工作流定义不存在或未发布");
    }
    if (e.message === ERROR_CODES.WORKFLOW_INSTANCE_EXISTS) {
      return failConflict(ERROR_CODES.WORKFLOW_INSTANCE_EXISTS, "该业务单据已存在审批实例");
    }
    throw e;
  });

  if (instance instanceof Response) return instance;

  await writeAuditLog({
    actorId: user?.id,
    action: "workflow-instance.create",
    entityType: "workflow-instance",
    entityId: instance.id,
    ipAddress: clientIp(request),
    meta: { businessType, businessId, definitionId },
  });

  return ok(instance, undefined, 201);
}
