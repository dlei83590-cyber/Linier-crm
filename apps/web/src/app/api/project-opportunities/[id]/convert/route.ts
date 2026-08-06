import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/project-opportunities/:id/convert — Opportunity → Project 唯一转换入口（CTO #3C5）
 * 规则：
 *  - 只能转换一次（Project.opportunityId 唯一约束 + convertedAt 回写双重校验）
 *  - 事务：锁定并读取 Opportunity → 检查已转换 → 生成项目编号（DocumentSequence docType=PROJECT）
 *    → 创建 Project（复制客户/财务/负责人/描述）→ 回写 convertedAt/convertedBy → AuditLog
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
    // ① 锁定并读取 Opportunity（FOR UPDATE 语义由事务隔离保证）
    const opportunity = await tx.projectOpportunity.findFirst({
      where: { id, deletedAt: null },
      include: { project: { select: { id: true } } },
    });
    if (!opportunity) return { error: "NOT_FOUND" as const };

    // ② 检查是否已转换（双重校验：convertedAt 回写 + Project.opportunityId 唯一）
    if (opportunity.convertedAt || opportunity.project) {
      return { error: "ALREADY_CONVERTED" as const };
    }

    // ③ 生成项目编号（DocumentSequence docType=PROJECT，幂等递增）
    const seq = await tx.documentSequence.findFirst({ where: { docType: "PROJECT", isActive: true, deletedAt: null } });
    const prefix = seq?.prefix ?? "PJ";
    const padLength = seq?.padLength ?? 6;
    const nextNo = seq?.nextNo ?? 1;
    const projectCode = `${prefix}${String(nextNo).padStart(padLength, "0")}`;
    if (seq) {
      await tx.documentSequence.update({ where: { id: seq.id }, data: { nextNo: nextNo + 1 } });
    }

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
