import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog, clientIp } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound, fail, failServer } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { effectiveStatusOf } from "@/lib/quotation/helpers";
import { publishQuotationEvent } from "@/lib/quotation/events";
import { resolveStepApprovers } from "@/lib/workflow/engine";

export const dynamic = "force-dynamic";

/**
 * POST /api/quotations/:id/submit（提交审批，Action API，不 PATCH status）
 * 流程：Quotation → ApprovalPolicy（module=QUOTATION，按 totalAmount 匹配 rule，priority DESC）
 *       → WorkflowDefinition → WorkflowInstance → Quotation.workflowInstanceId → status=SUBMITTED
 * 生成 QuotationSnapshot(SUBMITTED)；发布 QuotationSubmitted；不自动创建 WorkflowInstance 之外的其他单据。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // submit 映射现有动作（CTO：新动作不破坏 RBAC 规范，后续 ADR 再扩展）
  const denied = requirePermission(user, "quotation:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "quotation.submit");

  const { id } = await params;
  const meta = requestMeta(request);

  const quotation = await prisma.quotation.findFirst({
    where: { id, deletedAt: null },
    include: { lines: { where: { deletedAt: null } } },
  });
  if (!quotation) return failNotFound(ERROR_CODES.QUOTATION_NOT_FOUND, "报价单不存在");
  if (quotation.status !== "DRAFT") {
    return failConflict(ERROR_CODES.QUOTATION_INVALID_STATE, "仅 DRAFT 状态可提交审批");
  }
  if (quotation.lines.length === 0) {
    return failConflict(ERROR_CODES.QUOTATION_NO_LINES, "报价单至少需要一行明细");
  }
  if (effectiveStatusOf(quotation).isExpired) {
    return failConflict(ERROR_CODES.QUOTATION_EXPIRED, "报价已过期，禁止提交");
  }

  const totalAmount = quotation.totalAmount;
  const actorId = user!.id;

  // ① 匹配 ApprovalPolicy（只选择 Workflow，不执行审批；规则按 priority DESC 命中金额区间）
  const policy = await prisma.approvalPolicy.findFirst({
    where: { module: "QUOTATION", enabled: true, isActive: true, deletedAt: null },
    orderBy: { priority: "asc" },
  });
  const rules = policy
    ? await prisma.approvalPolicyRule.findMany({
        where: { policyId: policy.id, isActive: true, deletedAt: null },
        orderBy: { priority: "desc" },
      })
    : [];
  const matched = rules.find((r) => {
    const loOk = r.minAmount === null || totalAmount.gte(new Prisma.Decimal(r.minAmount));
    const hiOk = r.maxAmount === null || totalAmount.lt(new Prisma.Decimal(r.maxAmount));
    return loOk && hiOk;
  });
  if (!matched) {
    return fail(ERROR_CODES.QUOTATION_APPROVAL_POLICY_NOT_FOUND, "未匹配到报价审批策略（ApprovalPolicy），请检查策略配置", 409);
  }

  // ② 创建 WorkflowInstance（复用 Sprint 3A Workflow Engine：ACTIVE 定义 + 首步审批人解析）
  let instance;
  try {
    instance = await prisma.$transaction(async (tx) => {
    const definition = await tx.workflowDefinition.findFirst({
      where: { id: matched.workflowDefinitionId, deletedAt: null, status: "ACTIVE" },
      include: {
        steps: {
          where: { deletedAt: null },
          orderBy: { stepNo: "asc" },
          include: { conditions: { where: { deletedAt: null } } },
        },
      },
    });
    if (!definition) throw new Error("WORKFLOW_DEFINITION_NOT_FOUND");

    const dup = await tx.workflowInstance.findFirst({
      where: { businessType: "quotation", businessId: id, deletedAt: null },
      select: { id: true },
    });
    if (dup) throw new Error("WORKFLOW_INSTANCE_EXISTS");

    const firstStep = definition.steps[0];
    const startStepNo = firstStep?.stepNo ?? 1;
    const created = await tx.workflowInstance.create({
      data: {
        definitionId: definition.id,
        businessType: "quotation",
        businessId: id,
        currentStepNo: startStepNo,
        startedBy: actorId,
        status: "RUNNING",
        createdById: actorId,
        updatedById: actorId,
        actions: {
          create: {
            actionType: "SUBMIT",
            actorId,
            stepNo: startStepNo,
            comment: "提交报价审批",
            createdById: actorId,
            updatedById: actorId,
          },
        },
        history: {
          create: {
            stepNo: startStepNo,
            actionType: "SUBMIT",
            beforeStatus: null,
            afterStatus: "RUNNING",
            actorId,
            ip: clientIp(request) ?? null,
            remark: "提交报价审批",
            createdById: actorId,
            updatedById: actorId,
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
            createdById: actorId,
            updatedById: actorId,
          })),
        });
      }
    }

    // ③ 回写 Quotation：workflowInstanceId + status=SUBMITTED + 快照(SUBMITTED)
    const latestRevision = await tx.quotationRevision.findFirst({
      where: { quotationId: id, deletedAt: null },
      orderBy: { revisionNo: "desc" },
    });
    await tx.quotation.update({
      where: { id },
      data: { workflowInstanceId: created.id, status: "SUBMITTED", updatedById: actorId },
    });
    await tx.quotationSnapshot.create({
      data: {
        quotationId: id,
        snapshotType: "SUBMITTED",
        revisionNo: latestRevision?.revisionNo ?? 1,
        snapshotData: {
          status: "SUBMITTED",
          totalAmount: totalAmount.toNumber(),
          currency: quotation.currency,
          workflowInstanceId: created.id,
          submittedBy: actorId,
          submittedAt: new Date().toISOString(),
        },
        generatedById: actorId,
        createdById: actorId,
        updatedById: actorId,
      },
    });
    return created;
    }).catch((e: Error) => {
      if (e.message === "WORKFLOW_DEFINITION_NOT_FOUND") {
        throw new Error(ERROR_CODES.QUOTATION_WORKFLOW_FAILED);
      }
      if (e.message === "WORKFLOW_INSTANCE_EXISTS") {
        throw new Error(ERROR_CODES.WORKFLOW_INSTANCE_EXISTS);
      }
      throw e;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "UNKNOWN";
    if (msg === ERROR_CODES.QUOTATION_WORKFLOW_FAILED) {
      return fail(ERROR_CODES.QUOTATION_WORKFLOW_FAILED, "工作流定义不存在或未发布（QUOTATION_APPROVAL）", 409);
    }
    if (msg === ERROR_CODES.WORKFLOW_INSTANCE_EXISTS) {
      return failConflict(ERROR_CODES.WORKFLOW_INSTANCE_EXISTS, "该报价单已存在审批实例");
    }
    console.error("[quotation.submit] workflow failed:", e);
    return failServer("创建审批实例失败");
  }

  try {
    await publishQuotationEvent({
      eventType: "QuotationSubmitted",
      actorId,
      entityId: id,
      payload: {
        quotationId: id,
        quotationCode: quotation.code,
        revisionNo: 1,
        customerId: quotation.customerId,
        projectId: quotation.projectId,
        workflowInstanceId: instance.id,
        currency: quotation.currency,
        totalAmount: quotation.totalAmount,
        submittedBy: actorId,
      },
      meta,
    });
    await writeAuditLog({
      actorId,
      action: "quotation.submit",
      entityType: "quotation",
      entityId: id,
      afterData: { workflowInstanceId: instance.id, totalAmount: quotation.totalAmount },
      ...meta,
    });
  } catch {
    // 事件/审计失败不阻断主流程（总线未落地前为 AuditLog 留痕）
  }

  return ok({ id, status: "SUBMITTED", workflowInstanceId: instance.id });
}
