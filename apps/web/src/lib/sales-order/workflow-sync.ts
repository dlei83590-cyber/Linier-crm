import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveStepApprovers } from "@/lib/workflow/engine";
import { publishSalesOrderEvent } from "@/lib/sales-order/events";

/**
 * Sprint 4B - SalesOrder ↔ Workflow 集成（Workflow 条件触发）
 * 设计依据：ADR-0017 §6（Workflow / Approval 设计）+ CTO 锁定项③：
 *   - SO Confirm 不重复审批（Accepted Quotation 已完成商业审批，confirm 只做状态流转）；
 *   - 只有当 SO 修改了数量/价格/付款条件/交货条件等关键商业字段时，才触发新的审批流程。
 * 原则（与 quotation/workflow-sync 同构）：
 *   - WorkflowInstance/WorkflowAction/WorkflowHistory 为唯一审批事实源，SalesOrder 仅保存投影
 *     （workflowInstanceId / approvalStatus / approvedAt / approvedById）；
 *   - 审批动作复用 POST /api/workflows/instances/:id/actions；
 *   - ApprovalPolicy 复用：module="SALES_ORDER"（seed 未预置则编辑不受影响，策略配置后自动生效）。
 * 一致性区分：
 *   - syncSalesOrderApproval（审批终态投影回写）：DB 投影失败必须向上抛，调用方不得 .catch 吞掉；
 *   - maybeTriggerSalesOrderApproval（编辑后条件触发）：尽力而为，失败仅 AuditLog/console 留痕，不阻断编辑
 *     （编辑本身已成功，审批触发属于附加动作）。
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
 * 条件触发：SO 修改关键商业字段（数量/UOM/付款条件/交货条件等）时创建审批实例。
 * 规则：
 *   - module="SALES_ORDER" 的 ApprovalPolicy（enabled + isActive）+ 金额区间 rule（priority DESC 命中）；
 *   - 单一实例模型（WorkflowInstance @@unique([businessType, businessId])）：已有实例（含终态）不重复创建；
 *   - 无策略/未命中/已有实例 → 跳过（不阻塞编辑，返回 skipped 原因）；
 *   - 创建成功 → 回写 SO.workflowInstanceId + approvalStatus=PENDING（投影），发布 SalesOrderApprovalStarted 留痕。
 * 失败策略：触发失败不阻断编辑（编辑事务已提交），console.error + 返回 skipped="trigger-failed"。
 */
export async function maybeTriggerSalesOrderApproval(params: {
  salesOrderId: string;
  keyCommercialChanged: boolean;
  actorId: string;
  meta?: object;
}): Promise<{ triggered: boolean; instanceId?: string | null; skipped?: string }> {
  if (!params.keyCommercialChanged) return { triggered: false, skipped: "no-commercial-change" };

  const salesOrder = await prisma.salesOrder.findFirst({ where: { id: params.salesOrderId, deletedAt: null } });
  if (!salesOrder) return { triggered: false, skipped: "not-found" };

  // ① 匹配 SALES_ORDER 审批策略（未配置则不触发，编辑不受影响）
  const policy = await prisma.approvalPolicy.findFirst({
    where: { module: "SALES_ORDER", enabled: true, isActive: true, deletedAt: null },
    orderBy: { priority: "asc" },
  });
  if (!policy) return { triggered: false, skipped: "no-policy" };
  const rules = await prisma.approvalPolicyRule.findMany({
    where: { policyId: policy.id, isActive: true, deletedAt: null },
    orderBy: { priority: "desc" },
  });
  const matched = rules.find((r) => {
    const loOk = r.minAmount === null || salesOrder.totalAmount.gte(new Prisma.Decimal(r.minAmount));
    const hiOk = r.maxAmount === null || salesOrder.totalAmount.lt(new Prisma.Decimal(r.maxAmount));
    return loOk && hiOk;
  });
  if (!matched) return { triggered: false, skipped: "no-rule-matched" };

  // ② 单一实例模型：已有实例（含终态）不重复创建（与 quotation submit 的 WORKFLOW_INSTANCE_EXISTS 同构）
  const existing = await prisma.workflowInstance.findFirst({
    where: { businessType: "sales-order", businessId: salesOrder.id, deletedAt: null },
    select: { id: true, status: true },
  });
  if (existing) return { triggered: false, skipped: "instance-exists", instanceId: existing.id };

  try {
    const created = await prisma.$transaction(async (tx) => {
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

      const firstStep = definition.steps[0];
      const startStepNo = firstStep?.stepNo ?? 1;
      const instance = await tx.workflowInstance.create({
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
        const userIds = await resolveStepApprovers(tx, firstStep.approverType, firstStep.approverValue);
        if (userIds.length > 0) {
          await tx.approver.createMany({
            data: userIds.map((uid) => ({
              instanceId: instance.id,
              stepNo: firstStep.stepNo,
              userId: uid,
              status: "PENDING",
              createdById: params.actorId,
              updatedById: params.actorId,
            })),
          });
        }
      }

      // ③ 回写 SO 投影：workflowInstanceId + approvalStatus=PENDING
      await tx.salesOrder.update({
        where: { id: salesOrder.id },
        data: { workflowInstanceId: instance.id, approvalStatus: "PENDING", updatedById: params.actorId },
      });
      return instance;
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
        currency: salesOrder.currency,
        totalAmount: salesOrder.totalAmount,
      },
      meta: params.meta,
    }).catch(() => undefined);
    return { triggered: true, instanceId: created.id };
  } catch (e) {
    // 触发失败不阻断编辑（编辑事务已提交）：仅留痕
    console.error("[sales-order] approval trigger failed:", e);
    return { triggered: false, skipped: "trigger-failed" };
  }
}
