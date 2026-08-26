import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { nextDocumentCode } from "@/lib/document-sequence/next-code";

export const dynamic = "force-dynamic";

/**
 * POST /api/project-opportunities/:id/convert — Opportunity → Project 唯一转换入口（CTO #3C5）
 * 规则：
 *  - 只能转换一次（Project.opportunityId 唯一约束 + convertedAt 回写双重校验）
 *  - 事务：SELECT ... FOR UPDATE 真实行锁 → 检查已转换 → 原子递增生成项目编号
 *    → 创建 Project（复制客户/财务/负责人/描述）→ 回写 convertedAt/convertedBy → AuditLog
 *  - 并发安全（CTO 架构审核）：行锁串行化同一机会的并发转换；nextNo 原子递增避免重复编号；
 *    唯一约束冲突（P2002）兜底映射为 409，不暴露 Prisma 原始错误
 *  - 禁止通过普通 POST /projects 模拟转换
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-opportunity:create") ?? requirePermission(user, "project:create");
  if (denied) return denied;
  requestLog(request, user?.id, "project-opportunity.convert");

  const { id } = await params;
  const meta = requestMeta(request);

  const result = await prisma.$transaction(async (tx) => {
    // ① 真实数据库行锁：SELECT ... FOR UPDATE 锁定 Opportunity 行，串行化同一机会的并发转换
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "ProjectOpportunity" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: "NOT_FOUND" as const };

    // ② 读取 Opportunity（行已锁定）并检查是否已转换（convertedAt 回写 + Project.opportunityId 唯一双重校验）
    const opportunity = await tx.projectOpportunity.findFirst({
      where: { id, deletedAt: null },
      include: { project: { select: { id: true } } },
    });
    if (!opportunity) return { error: "NOT_FOUND" as const };
    if (opportunity.convertedAt || opportunity.project) {
      return { error: "ALREADY_CONVERTED" as const };
    }

    // ③ 生成项目编号（单据序列重构：PJ-LNE{YYYY}{MM}{####}；缺失 fail closed）
    const projectCode = await nextDocumentCode(tx, "PROJECT", new Date());

    // ④ 创建 Project（复制客户/财务/负责人/描述；stage 默认 SAMPLING）
    const project = await tx.project.create({
      data: {
        code: projectCode,
        name: opportunity.name,
        opportunityId: opportunity.id,
        customerId: opportunity.customerId,
        stage: "SAMPLING",
        customerInvestment: opportunity.customerInvestment,
        expectedRevenue: opportunity.expectedRevenue,
        expectedCost: opportunity.expectedCost,
        grossProfit: opportunity.grossProfit,
        expenseBudget: opportunity.expenseBudget,
        salesTarget: opportunity.salesTarget,
        paymentStatus: opportunity.paymentStatus,
        competitors: opportunity.competitors ?? undefined,
        successProbability: opportunity.successProbability,
        ownerId: opportunity.ownerId,
        description: opportunity.description,
        approvalStatus: "APPROVED",
        createdById: user!.id,
        updatedById: user!.id,
      },
    });

    // ⑤ 回写 Opportunity：convertedAt / convertedBy
    await tx.projectOpportunity.update({
      where: { id: opportunity.id },
      data: { convertedAt: new Date(), convertedBy: user!.id, updatedById: user!.id },
    });

    return { error: null as null, opportunity, project };
  }).catch((err: unknown) => {
    // 兜底：唯一约束冲突（并发重复转换/编号冲突）稳定返回 409，不暴露 Prisma P2002
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: "ALREADY_CONVERTED" as const };
    }
    throw err;
  });

  if (result.error === "NOT_FOUND") {
    return failNotFound(ERROR_CODES.NOT_FOUND, "销售机会不存在");
  }
  if (result.error === "ALREADY_CONVERTED") {
    return failConflict(ERROR_CODES.CONFLICT, "该机会已转换为项目，禁止重复转换");
  }

  await writeAuditLog({
    actorId: user?.id,
    action: "project-opportunity.convert",
    entityType: "projectOpportunity",
    entityId: id,
    afterData: { projectId: result.project.id, projectCode: result.project.code, convertedBy: user?.id },
    ...meta,
  });

  // Domain Event：ProjectOpportunityConverted（事件总线 Sprint 4 前落地；此处以 AuditLog + EVENTS.md 注册为准）
  return ok({ project: result.project, opportunityId: id, converted: true });
}
