import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, clientIp, writeAuditLog } from "@/lib/api-helpers";
import { ok, fail, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { workflowDefinitionCreateSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

/**
 * GET /api/workflows/definitions
 * 工作流定义列表（分页 + code/name/module/status 搜索 + 软删除过滤）
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "workflow-definition:view");
  if (denied) return denied;
  requestLog(request, user?.id, "workflow-definition.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const name = searchParams.get("name")?.trim();
  const module = searchParams.get("module")?.trim();
  const status = searchParams.get("status")?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code } } : {}),
    ...(name ? { name: { contains: name } } : {}),
    ...(module ? { module } : {}),
    ...(status ? { status } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.workflowDefinition.count({ where }),
    prisma.workflowDefinition.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take,
      include: {
        steps: {
          where: { deletedAt: null },
          orderBy: { stepNo: "asc" },
          include: { conditions: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } } },
        },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/**
 * POST /api/workflows/definitions
 * 创建工作流定义（含步骤与条件，事务写入）
 */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "workflow-definition:create");
  if (denied) return denied;
  requestLog(request, user?.id, "workflow-definition.create");

  const parsed = workflowDefinitionCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { steps, ...definition } = parsed.data;

  const existing = await prisma.workflowDefinition.findUnique({ where: { code: definition.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.WORKFLOW_DEFINITION_CODE_EXISTS, "工作流编码已存在");
  }

  const created = await prisma.$transaction(async (tx) => {
    const wf = await tx.workflowDefinition.create({
      data: {
        ...definition,
        status: "DRAFT",
        createdById: user!.id,
        updatedById: user!.id,
        steps: {
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
      },
      include: {
        steps: {
          where: { deletedAt: null },
          orderBy: { stepNo: "asc" },
          include: { conditions: { where: { deletedAt: null } } },
        },
      },
    });
    return wf;
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "workflow-definition.create",
    entityType: "workflow-definition",
    entityId: created.id,
    ipAddress: clientIp(request),
    meta: { code: created.code, module: created.module },
  });

  return ok(created, undefined, 201);
}
