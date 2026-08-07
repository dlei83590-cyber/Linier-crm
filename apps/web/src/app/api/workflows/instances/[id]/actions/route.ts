import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, clientIp, writeAuditLog } from "@/lib/api-helpers";
import { ok, fail, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { workflowActionSchema } from "@/lib/api/schemas";
import { isValidAction, isStepComplete, resolveStepApprovers } from "@/lib/workflow/engine";
import { syncQuotationApproval } from "@/lib/quotation/workflow-sync";

export const dynamic = "force-dynamic";

const TERMINAL_STATES = ["COMPLETED", "REJECTED", "TERMINATED", "WITHDRAWN"] as const;

/**
 * POST /api/workflows/instances/:id/actions
 * 统一动作：SUBMIT/APPROVE/REJECT/RETURN/TRANSFER/DELEGATE/WITHDRAW/TERMINATE/COMMENT
 * 状态机事务：更新审批人状态 → 推进/结束实例 → 写入 Action + History
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "workflow-instance:approve");
  if (denied) return denied;
  requestLog(request, user?.id, "workflow-instance.action");

  const { id } = await params;
  const parsed = workflowActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { actionType, targetUserId, comment } = parsed.data;

  if (!isValidAction(actionType)) {
    return fail(ERROR_CODES.WORKFLOW_ACTION_INVALID, "无效的工作流动作", 400);
  }
  if ((actionType === "TRANSFER" || actionType === "DELEGATE") && !targetUserId) {
    return fail(ERROR_CODES.WORKFLOW_TARGET_REQUIRED, "转交/委托必须指定 targetUserId", 400);
  }

  // 预加载（事务外校验，避免长事务）
  const instance = await prisma.workflowInstance.findFirst({ where: { id, deletedAt: null } });
  if (!instance) {
    return failNotFound(ERROR_CODES.WORKFLOW_INSTANCE_NOT_FOUND, "审批实例不存在");
  }
  if ((TERMINAL_STATES as readonly string[]).includes(instance.status) && actionType !== "COMMENT") {
    return failConflict(ERROR_CODES.WORKFLOW_INSTANCE_CLOSED, "审批已结束，仅可评论");
  }

  const definition = await prisma.workflowDefinition.findFirst({
    where: { id: instance.definitionId, deletedAt: null },
    include: {
      steps: {
        where: { deletedAt: null },
        orderBy: { stepNo: "asc" },
        include: { conditions: { where: { deletedAt: null } } },
      },
    },
  });
  if (!definition) {
    return failNotFound(ERROR_CODES.WORKFLOW_DEFINITION_NOT_FOUND, "工作流定义不存在");
  }

  const currentStepNo = instance.currentStepNo ?? 1;
  const currentApprovers = await prisma.approver.findMany({
    where: { instanceId: id, stepNo: currentStepNo, deletedAt: null },
  });

  // 需要"我的待办"的动作：审批/驳回/转交/委托
  const needMine = ["APPROVE", "REJECT", "TRANSFER", "DELEGATE"];
  if ((needMine as readonly string[]).includes(actionType)) {
    const mine = currentApprovers.find((a) => a.userId === user!.id && a.status === "PENDING");
    if (!mine) {
      return fail(ERROR_CODES.WORKFLOW_ACTION_FORBIDDEN, "您没有当前步骤的待审批任务", 403);
    }
  }
  if (actionType === "WITHDRAW" && instance.startedBy !== user!.id) {
    return fail(ERROR_CODES.WORKFLOW_ACTION_FORBIDDEN, "仅发起人可撤销", 403);
  }

  const now = new Date();
  const ua = request.headers.get("user-agent") ?? "";
  const device = /mobile|android|iphone/i.test(ua) ? "mobile" : "desktop";
  const browser = ua.split(" ")[0] ?? null;

  const result = await prisma.$transaction(async (tx) => {
    const beforeStatus = instance.status;
    let afterStatus: string = instance.status;
    let newStepNo: number | null = currentStepNo;
    let completedAt: Date | null = null;
    let extraApproverIds: string[] = [];

    if (actionType === "APPROVE") {
      const target = currentApprovers.find((a) => a.userId === user!.id && a.status === "PENDING")!;
      await tx.approver.update({
        where: { id: target.id },
        data: { status: "APPROVED", decidedAt: now, comment: comment ?? null, updatedById: user!.id },
      });
      const updated = currentApprovers.map((a) =>
        a.id === target.id ? { ...a, status: "APPROVED" as const } : a,
      );
      const step = definition.steps.find((s) => s.stepNo === currentStepNo);
      // COUNTERSIGN 会签：默认要求全部审批人通过（等同 PARALLEL），避免无法推进
      const complete = isStepComplete(
        step?.approvalMode ?? "SEQUENTIAL",
        updated,
        step?.approvalMode === "COUNTERSIGN" ? updated.length : undefined,
      );
      if (complete) {
        const nextStep = definition.steps.find((s) => s.stepNo > currentStepNo);
        if (nextStep) {
          newStepNo = nextStep.stepNo;
          const userIds = await resolveStepApprovers(tx, nextStep.approverType, nextStep.approverValue);
          extraApproverIds = userIds;
          await tx.approver.createMany({
            data: userIds.map((uid) => ({
              instanceId: id,
              stepNo: nextStep.stepNo,
              userId: uid,
              status: "PENDING",
              createdById: user!.id,
              updatedById: user!.id,
            })),
          });
          await tx.workflowInstance.update({
            where: { id },
            data: { currentStepNo: nextStep.stepNo, updatedById: user!.id },
          });
        } else {
          afterStatus = "COMPLETED";
          completedAt = now;
          await tx.workflowInstance.update({
            where: { id },
            data: { status: "COMPLETED", completedAt: now, updatedById: user!.id },
          });
        }
      }
    }

    if (actionType === "REJECT") {
      const target = currentApprovers.find((a) => a.userId === user!.id && a.status === "PENDING")!;
      await tx.approver.update({
        where: { id: target.id },
        data: { status: "REJECTED", decidedAt: now, comment: comment ?? null, updatedById: user!.id },
      });
      afterStatus = "REJECTED";
      completedAt = now;
      await tx.workflowInstance.update({
        where: { id },
        data: { status: "REJECTED", completedAt: now, updatedById: user!.id },
      });
    }

    if (actionType === "RETURN") {
      const prevStep = definition.steps.find((s) => s.stepNo < currentStepNo);
      if (!prevStep) {
        // 第一步退回 = 驳回
        afterStatus = "REJECTED";
        completedAt = now;
        await tx.workflowInstance.update({
          where: { id },
          data: { status: "REJECTED", completedAt: now, updatedById: user!.id },
        });
      } else {
        await tx.approver.updateMany({
          where: { instanceId: id, stepNo: currentStepNo, deletedAt: null },
          data: { status: "SKIPPED", updatedById: user!.id },
        });
        newStepNo = prevStep.stepNo;
        const userIds = await resolveStepApprovers(tx, prevStep.approverType, prevStep.approverValue);
        extraApproverIds = userIds;
        await tx.approver.createMany({
          data: userIds.map((uid) => ({
            instanceId: id,
            stepNo: prevStep.stepNo,
            userId: uid,
            status: "PENDING",
            createdById: user!.id,
            updatedById: user!.id,
          })),
        });
        await tx.workflowInstance.update({
          where: { id },
          data: { currentStepNo: prevStep.stepNo, updatedById: user!.id },
        });
      }
    }

    if (actionType === "TRANSFER") {
      const target = currentApprovers.find((a) => a.userId === user!.id && a.status === "PENDING")!;
      await tx.approver.update({
        where: { id: target.id },
        data: { userId: targetUserId!, updatedById: user!.id },
      });
    }

    if (actionType === "DELEGATE") {
      const target = currentApprovers.find((a) => a.userId === user!.id && a.status === "PENDING")!;
      await tx.approver.update({
        where: { id: target.id },
        data: { status: "DELEGATED", delegatedFrom: user!.id, decidedAt: now, updatedById: user!.id },
      });
      await tx.approver.create({
        data: {
          instanceId: id,
          stepNo: currentStepNo,
          userId: targetUserId!,
          status: "PENDING",
          delegatedFrom: user!.id,
          createdById: user!.id,
          updatedById: user!.id,
        },
      });
    }

    if (actionType === "WITHDRAW") {
      afterStatus = "WITHDRAWN";
      completedAt = now;
      await tx.workflowInstance.update({
        where: { id },
        data: { status: "WITHDRAWN", completedAt: now, updatedById: user!.id },
      });
    }

    if (actionType === "TERMINATE") {
      afterStatus = "TERMINATED";
      completedAt = now;
      await tx.workflowInstance.update({
        where: { id },
        data: { status: "TERMINATED", completedAt: now, updatedById: user!.id },
      });
    }

    if (actionType === "SUBMIT") {
      if ((TERMINAL_STATES as readonly string[]).includes(instance.status)) {
        // 重新提交：回到运行中，重置到第一步
        const firstStep = definition.steps[0];
        newStepNo = firstStep?.stepNo ?? 1;
        afterStatus = "RUNNING";
        completedAt = null;
        await tx.workflowInstance.update({
          where: { id },
          data: { status: "RUNNING", currentStepNo: newStepNo, completedAt: null, updatedById: user!.id },
        });
        if (firstStep) {
          const userIds = await resolveStepApprovers(tx, firstStep.approverType, firstStep.approverValue);
          extraApproverIds = userIds;
          await tx.approver.createMany({
            data: userIds.map((uid) => ({
              instanceId: id,
              stepNo: firstStep.stepNo,
              userId: uid,
              status: "PENDING",
              createdById: user!.id,
              updatedById: user!.id,
            })),
          });
        }
      }
    }

    // COMMENT：无状态变更，仅记录
    const duration = completedAt ? Math.max(0, Math.round((completedAt.getTime() - instance.startedAt.getTime()) / 1000)) : null;

    const action = await tx.workflowAction.create({
      data: {
        instanceId: id,
        actionType,
        actorId: user!.id,
        targetUserId: targetUserId ?? null,
        stepNo: newStepNo ?? currentStepNo,
        comment: comment ?? null,
        createdById: user!.id,
        updatedById: user!.id,
      },
    });

    await tx.workflowHistory.create({
      data: {
        instanceId: id,
        stepNo: newStepNo ?? currentStepNo,
        actionType,
        beforeStatus: beforeStatus === afterStatus && actionType === "COMMENT" ? instance.status : beforeStatus,
        afterStatus,
        actorId: user!.id,
        ip: clientIp(request) ?? null,
        device,
        browser,
        remark: comment ?? null,
        duration,
        createdById: user!.id,
        updatedById: user!.id,
      },
    });

    return { action, afterStatus, currentStepNo: newStepNo, completedAt, extraApproverIds };
  });

  await writeAuditLog({
    actorId: user?.id,
    action: `workflow-instance.${actionType.toLowerCase()}`,
    entityType: "workflow-instance",
    entityId: id,
    ipAddress: clientIp(request),
    meta: { actionType, afterStatus: result.afterStatus },
  });

  // Sprint 4A：Quotation 审批终态回写（Workflow 为唯一事实源，Quotation 仅保存投影 + 发布事件）
  if (
    instance.businessType === "quotation" &&
    (result.afterStatus === "COMPLETED" || result.afterStatus === "REJECTED")
  ) {
    await syncQuotationApproval({
      quotationId: instance.businessId,
      workflowStatus: result.afterStatus,
      actorId: user!.id,
    }).catch(() => undefined);
  }

  return ok({ instanceId: id, ...result });
}
