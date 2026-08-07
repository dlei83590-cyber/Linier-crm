import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveStepApprovers } from "@/lib/workflow/engine";
import { publishSalesOrderEvent } from "@/lib/sales-order/events";

/**
 * Sprint 4B - SalesOrder ↔ Workflow 集成（Workflow 条件触发）
 * 设计依据：ADR-0017 §6（Workflow / Approval 设计）+ CTO 锁定项③ + CTO Final Review（阻断项②③）：
 *   - SO Confirm 不重复审批（Accepted Quotation 已完成商业审批，confirm 只做状态流转）；
 *   - 只有当 SO 修改了数量/价格/付款条件/交货条件等关键商业字段时，才触发新的审批流程；
 *   - **商业条件变更必须重新审批（阻断项②）**：已有 RUNNING 实例 → 保持等待不重复创建；
 *     已有终态实例（COMPLETED/REJECTED/WITHDRAWN 等）→ 复用该 WorkflowInstance 重新 SUBMIT 重启审批（approvalStatus=PENDING）；
 *     无实例 → 创建新实例；
 *   - **触发失败不得静默（非阻断建议→采纳）**：已配置并命中 SALES_ORDER ApprovalPolicy 时，
 *     Workflow 创建/复用失败必须显式抛错（由调用方主事务整体回滚并返回显式错误），禁止"改成功但没进审批"。
 * 原则（与 quotation/workflow-sync 同构）：
 *   - WorkflowInstance/WorkflowAction/WorkflowHistory 为唯一审批事实源，SalesOrder 仅保存投影
 *     （workflowInstanceId / approvalStatus / approvedAt / approvedById）；
 *   - 审批动作复用 POST /api/workflows/instances/:id/actions；
 *   - ApprovalPolicy 复用：module="SALES_ORDER"（seed 未预置则编辑不受影响，策略配置后自动生效）；
 *   - 单实例架构：WorkflowInstance @@unique([businessType, businessId]) 保持不变（CTO：不修改唯一约束、不新增 Approval 表）。
 */

/**
 * 审批终态回写（调用方：workflows/instances/[id]/actions，businessType === "sales-order"）
 * COMPLETED → approvalStatus=APPROVED + approvedAt + approvedById；REJECTED → approvalStatus=REJECTED。
 * 注意：SalesOrderSnapshotType 仅有 CREATED/CONFIRMED/CANCELLED（无 APPROVED），审批终态只回写投影、不生成快照。
 * 审批事件（SalesOrderApproved/Rejected）未注册 EVENTS.md 领域事件，仅经 publishSalesOrderEvent 以 AuditLog 留痕。
 */
export async function syncSalesOrderApproval(params: {
  salesOrderId: string;
  workflowStatus: string; // COMPLETED | REJECTED
  actorId: string;
}) {
  const salesOrder = await prisma.salesOrder.findFirst({ where: { id: params.salesOrderId, deletedAt: null } });
  if (!salesOrder) return;

  if (params.workflowStatus === "COMPLETED") {
    await prisma.salesOrder.update({
      where: { id: salesOrder.id },
      data: {
        approvalStatus: "APPROVED",
        approvedAt: new Date(),
        approvedById: params.actorId,
        updatedById: params.actorId,
      },
    });
    await publishSalesOrderEvent({
      eventType: "SalesOrderApproved",
      actorId: params.actorId,
      entityId: salesOrder.id,
      payload: {
        salesOrderId: salesOrder.id,
        salesOrderCode: salesOrder.code,
        quotationId: salesOrder.quotationId,
        customerId: salesOrder.customerId,
        projectId: salesOrder.projectId,
        workflowInstanceId: salesOrder.workflowInstanceId,
        currency: salesOrder.currency,
        totalAmount: salesOrder.totalAmount,
        approverId: params.actorId,
      },
    }).catch(() => undefined);
    return;
  }

  if (params.workflowStatus === "REJECTED") {
    await prisma.salesOrder.update({
      where: { id: salesOrder.id },
      data: { approvalStatus: "REJECTED", updatedById: params.actorId },
    });
    await publishSalesOrderEvent({
      eventType: "SalesOrderRejected",
      actorId: params.actorId,
      entityId: salesOrder.id,
      payload: {
        salesOrderId: salesOrder.id,
        salesOrderCode: salesOrder.code,
        quotationId: salesOrder.quotationId,
        customerId: salesOrder.customerId,
        projectId: salesOrder.projectId,
        workflowInstanceId: salesOrder.workflowInstanceId,
        currency: salesOrder.currency,
        totalAmount: salesOrder.totalAmount,
        approverId: params.actorId,
      },
    }).catch(() => undefined);
  }
}

/**
 * 条件触发：SO 修改关键商业字段（数量/UOM/付款条件/交货条件等）时创建或重启审批实例。
 * 规则（CTO Final Review 阻断项②）：
 *   - module="SALES_ORDER" 的 ApprovalPolicy（enabled + isActive）+ 金额区间 rule（priority DESC 命中）；
 *   - 无实例 → 创建新实例；已有 RUNNING → 不重复创建（保持 PENDING，返回 skipped="instance-running"）；
 *     已有终态（COMPLETED/REJECTED/WITHDRAWN/TERMINATED）→ 复用该实例重新 SUBMIT 重启审批（approvalStatus=PENDING）；
 *   - 无策略/未命中/非商业变更 → 跳过（不阻塞编辑）；
 *   - **命中策略后创建/复用失败 → 显式抛错**（不静默），调用方主事务整体回滚并返回显式错误；
 *   - 事件发布（SalesOrderApprovalStarted）在事务内发布（AuditLog 独立连接写入，失败降级不阻断主流程）。
 */
export async function maybeTriggerSalesOrderApproval(params: {
  salesOrderId: string;
  keyCommercialChanged: boolean;
  actorId: string;
  meta?: object;
  /** 调用方主事务客户端：传入则全部 DB 写入加入该事务（商业修改 + 审批创建原子）；不传则独立执行 */
  tx?: Prisma.TransactionClient;
}): Promise<{ triggered: boolean; instanceId?: string | null; resubmitted?: boolean; skipped?: string }> {
  if (!params.keyCommercialChanged) return { triggered: false, skipped: "no-commercial-change" };

  const db = params.tx ?? prisma;
  const salesOrder = await db.salesOrder.findFirst({ where: { id: params.salesOrderId, deletedAt: null } });
  if (!salesOrder) return { triggered: false, skipped: "not-found" };

  // ① 匹配 SALES_ORDER 审批策略（未配置则不触发，编辑不受影响）
  const policy = await db.approvalPolicy.findFirst({
    where: { module: "SALES_ORDER", enabled: true, isActive: true, deletedAt: null },
    orderBy: { priority: "asc" },
  });
  if (!policy) return { triggered: false, skipped: "no-policy" };
  const rules = await db.approvalPolicyRule.findMany({
    where: { policyId: policy.id, isActive: true, deletedAt: null },
    orderBy: { priority: "desc" },
  });
  const matched = rules.find((r) => {
    const loOk = r.minAmount === null || salesOrder.totalAmount.gte(new Prisma.Decimal(r.minAmount));
    const hiOk = r.maxAmount === null || salesOrder.totalAmount.lt(new Prisma.Decimal(r.maxAmount));
    return loOk && hiOk;
  });
  if (!matched) return { triggered: false, skipped: "no-rule-matched" };

  // ② 工作流定义（ACTIVE）：缺失视为配置错误，命中策略后必须显式报错（不静默）
  const definition = await db.workflowDefinition.findFirst({
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

  const firstStep = definition.steps[0];
  const startStepNo = firstStep?.stepNo ?? 1;

  // ③ 已有实例判断（单实例架构 @@unique([businessType, businessId])，不修改唯一约束）
  const existing = await db.workflowInstance.findFirst({
    where: { businessType: "sales-order", businessId: salesOrder.id, deletedAt: null },
    select: { id: true, status: true },
  });

  if (existing) {
    // RUNNING：审批进行中，不重复创建，保持 PENDING
    if (existing.status === "RUNNING") {
      return { triggered: false, skipped: "instance-running", instanceId: existing.id };
    }
    // 终态（COMPLETED/REJECTED/WITHDRAWN/TERMINATED）：复用该实例重新 SUBMIT 重启审批（CTO Final Review 阻断项②）
    await db.workflowInstance.update({
      where: { id: existing.id },
      data: { status: "RUNNING", currentStepNo: startStepNo, completedAt: null, updatedById: params.actorId },
    });
    // CTO 最终复审（残余阻断项）：重新审批前必须失效上一轮全部 Approver（isActive=false + deletedAt=now），
    // 否则旧 REJECTED/PENDING 记录仍被 isStepComplete 读取（SEQUENTIAL/PARALLEL 要求全部 APPROVED），
    // 会导致新一轮审批永远无法完成。针对整个 instance 失效（上一轮可能经过多个 step），
    // 现有 Workflow Action where deletedAt=null 自然只读取本轮审批人，无需修改 Workflow Engine。
    await db.approver.updateMany({
      where: { instanceId: existing.id, deletedAt: null },
      data: { isActive: false, deletedAt: new Date(), updatedById: params.actorId },
    });
    await db.workflowAction.create({
      data: {
        instanceId: existing.id,
        actionType: "SUBMIT",
        actorId: params.actorId,
        stepNo: startStepNo,
        comment: "销售订单商业条件变更，重新提交审批",
        createdById: params.actorId,
        updatedById: params.actorId,
      },
    });
    await db.workflowHistory.create({
      data: {
        instanceId: existing.id,
        stepNo: startStepNo,
        actionType: "SUBMIT",
        beforeStatus: null,
        afterStatus: "RUNNING",
        actorId: params.actorId,
        remark: "销售订单商业条件变更，重新提交审批",
        createdById: params.actorId,
        updatedById: params.actorId,
      },
    });
    if (firstStep) {
      const userIds = await resolveStepApprovers(db, firstStep.approverType, firstStep.approverValue);
      if (userIds.length > 0) {
        await db.approver.createMany({
          data: userIds.map((uid) => ({
            instanceId: existing.id,
            stepNo: firstStep.stepNo,
            userId: uid,
            status: "PENDING",
            createdById: params.actorId,
            updatedById: params.actorId,
          })),
        });
      }
    }
    // 回写 SO 投影：approvalStatus=PENDING，同时清空上一轮残留的 approvedAt/approvedById（保持语义一致）
    await db.salesOrder.update({
      where: { id: salesOrder.id },
      data: { approvalStatus: "PENDING", approvedAt: null, approvedById: null, updatedById: params.actorId },
    });
    await publishSalesOrderEvent({
      eventType: "SalesOrderApprovalStarted",
      actorId: params.actorId,
      entityId: salesOrder.id,
      payload: {
        salesOrderId: salesOrder.id,
        salesOrderCode: salesOrder.code,
        quotationId: salesOrder.quotationId,
        customerId: salesOrder.customerId,
        projectId: salesOrder.projectId,
        workflowInstanceId: existing.id,
        resubmitted: true,
        currency: salesOrder.currency,
        totalAmount: salesOrder.totalAmount,
      },
      meta: params.meta,
    }).catch(() => undefined);
    return { triggered: true, instanceId: existing.id, resubmitted: true };
  }

  // ④ 无实例 → 创建新实例（与编辑同一事务：失败整体回滚，显式报错）
  const created = await db.workflowInstance.create({
    data: {
      definitionId: definition.id,
      businessType: "sales-order",
      businessId: salesOrder.id,
      currentStepNo: startStepNo,
      startedBy: params.actorId,
      status: "RUNNING",
      createdById: params.actorId,
      updatedById: params.actorId,
      actions: {
        create: {
          actionType: "SUBMIT",
          actorId: params.actorId,
          stepNo: startStepNo,
          comment: "销售订单商业条件变更，触发审批",
          createdById: params.actorId,
          updatedById: params.actorId,
        },
      },
      history: {
        create: {
          stepNo: startStepNo,
          actionType: "SUBMIT",
          beforeStatus: null,
          afterStatus: "RUNNING",
          actorId: params.actorId,
          remark: "销售订单商业条件变更，触发审批",
          createdById: params.actorId,
          updatedById: params.actorId,
        },
      },
    },
  });

  if (firstStep) {
    const userIds = await resolveStepApprovers(db, firstStep.approverType, firstStep.approverValue);
    if (userIds.length > 0) {
      await db.approver.createMany({
        data: userIds.map((uid) => ({
          instanceId: created.id,
          stepNo: firstStep.stepNo,
          userId: uid,
          status: "PENDING",
          createdById: params.actorId,
          updatedById: params.actorId,
        })),
      });
    }
  }

  // ⑤ 回写 SO 投影：workflowInstanceId + approvalStatus=PENDING
  await db.salesOrder.update({
    where: { id: salesOrder.id },
    data: { workflowInstanceId: created.id, approvalStatus: "PENDING", updatedById: params.actorId },
  });
  await publishSalesOrderEvent({
    eventType: "SalesOrderApprovalStarted",
    actorId: params.actorId,
    entityId: salesOrder.id,
    payload: {
      salesOrderId: salesOrder.id,
      salesOrderCode: salesOrder.code,
      quotationId: salesOrder.quotationId,
      customerId: salesOrder.customerId,
      projectId: salesOrder.projectId,
      workflowInstanceId: created.id,
      resubmitted: false,
      currency: salesOrder.currency,
      totalAmount: salesOrder.totalAmount,
    },
    meta: params.meta,
  }).catch(() => undefined);
  return { triggered: true, instanceId: created.id, resubmitted: false };
}
