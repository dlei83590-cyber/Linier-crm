import { NextRequest } from "next/server";
import { Prisma, type ProjectStage, type PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { casUpdate } from "@/lib/api/cas";
import { z } from "zod";

export const dynamic = "force-dynamic";

const opportunityUpdateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    stage: z.enum(["LEAD", "QUALIFIED", "SOLUTION", "QUOTATION", "SAMPLING", "TESTING", "SMALL_BATCH", "MASS_SUPPLY", "PAUSED", "FAILED", "CLOSED"]).optional(),
    customerInvestment: z.coerce.number().nonnegative().nullable().optional(),
    expectedRevenue: z.coerce.number().nonnegative().nullable().optional(),
    expectedCost: z.coerce.number().nonnegative().nullable().optional(),
    grossProfit: z.coerce.number().nullable().optional(),
    expenseBudget: z.coerce.number().nonnegative().nullable().optional(),
    salesTarget: z.coerce.number().nonnegative().nullable().optional(),
    paymentStatus: z.enum(["UNPAID", "PARTIAL", "PAID", "OVERDUE"]).optional(),
    competitors: z.array(z.object({ name: z.string(), note: z.string().optional() })).nullable().optional(),
    successProbability: z.coerce.number().min(0).max(100).nullable().optional(),
    ownerId: z.string().min(1).nullable().optional(),
    description: z.string().max(1000).nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/project-opportunities/:id（详情含客户/关联项目） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-opportunity:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-opportunity.get");

  const { id } = await params;
  const opportunity = await prisma.projectOpportunity.findFirst({
    where: { id, deletedAt: null },
    include: {
      customer: { select: { id: true, code: true, name: true, type: true } },
      project: { select: { id: true, code: true, name: true, stage: true } },
    },
  });
  if (!opportunity) return failNotFound(ERROR_CODES.NOT_FOUND, "销售机会不存在");
  return ok(opportunity);
}

/** PATCH /api/project-opportunities/:id（乐观锁 version；已转换后禁止改关键字段） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-opportunity:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "project-opportunity.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = opportunityUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, stage, paymentStatus, competitors, ...rest } = parsed.data;
  const existing = await prisma.projectOpportunity.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "销售机会不存在");
  
  // 业务规则：已转换的机会禁止修改关键字段（转换走唯一入口 convert）
  if (existing.convertedAt && stage !== undefined) {
    return failConflict(ERROR_CODES.CONFLICT, "机会已转换为项目，禁止修改阶段等关键字段");
  }

  const cas = await casUpdate(prisma, 'projectOpportunity', id, version, {
      ...rest,
      stage: stage as ProjectStage | undefined,
      paymentStatus: paymentStatus as PaymentStatus | undefined,
      competitors:
        competitors === undefined
          ? undefined
          : competitors === null
            ? Prisma.DbNull
            : (competitors as Prisma.InputJsonValue),
      updatedById: user!.id,
    
});
  if (cas.outcome === 'NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, "销售机会不存在");
  if (cas.outcome === 'CONFLICT') return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  const updated = await prisma.projectOpportunity.findFirst({ where: { id, deletedAt: null } });
  if (!updated) return failNotFound(ERROR_CODES.NOT_FOUND, "销售机会不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "project-opportunity.update",
    entityType: "projectOpportunity",
    entityId: id,
    beforeData: { name: existing.name, stage: existing.stage },
    afterData: { name: updated.name, stage: updated.stage },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/project-opportunities/:id（软删除；已转换项目禁止删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-opportunity:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "project-opportunity.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.projectOpportunity.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "销售机会不存在");
  if (existing.convertedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "机会已转换为项目，禁止删除");
  }

  await prisma.projectOpportunity.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "project-opportunity.delete",
    entityType: "projectOpportunity",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
