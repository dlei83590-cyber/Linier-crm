import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveStepApprovers } from "@/lib/workflow/engine";
import { publishInvoiceEvent } from "@/lib/invoice/events";

/**
 * Sprint 4D - Invoice ↔ Workflow 集成（Workflow 条件触发）
 * 设计依据：ADR-0019（Invoice Domain）+ CTO Phase 4 指令：
 *   - DRAFT 编辑本身不自动审批；issue 前命中 Invoice 审批策略则必须先完成审批；
 *     workflowInstanceId != null 时只有 approvalStatus=APPROVED 才允许 Issue（issue 路由做门禁）；
 *   - 只有修改影响财务结果的字段（paymentTerm/dueDate/taxProfileId）才触发新的审批流程；
 *     普通 remark/reference 修改不触发重审（keyFinancialChanged=false 直接跳过）；
 *   - **再次审批**：已有 RUNNING 实例 → 保持等待不重复创建；已有终态实例（COMPLETED/REJECTED/WITHDRAWN 等）
 *     → 复用该 WorkflowInstance 重新 SUBMIT 重启审批（approvalStatus=PENDING）；
 *   - **触发失败不得静默**：命中 INVOICE ApprovalPolicy 时创建/复用失败必须显式抛错（调用方主事务回滚并显式报错）；
 * 原则（与 quotation/sales-order workflow-sync 完全同构）：
 *   - WorkflowInstance/WorkflowAction/WorkflowHistory 为唯一审批事实源，Invoice 仅保存投影
 *     （workflowInstanceId / approvalStatus / approvedAt / approvedById）；
 *   - 审批动作复用 POST /api/workflows/instances/:id/actions；
 *   - ApprovalPolicy 复用：module="INVOICE"（seed 未预置则编辑不受影响，策略配置后自动生效）；
 *   - 单实例架构：WorkflowInstance @@unique([businessType, businessId]) 保持不变；不建 InvoiceApproval 表。
 */

/**
 * 审批终态回写（调用方：workflows/instances/[id]/actions，businessType === "invoice"）
 * COMPLETED → approvalStatus=APPROVED + approvedAt + approvedById；REJECTED → approvalStatus=REJECTED。
 * 注意：InvoiceSnapshotType 仅有 CREATED/ISSUED/CANCELLED（无 APPROVED），审批终态只回写投影、不生成快照。
 * 审批事件（InvoiceApproved/Rejected）未注册 EVENTS.md 领域事件，仅经 publishInvoiceEvent 以 AuditLog 留痕。
 */
export async function syncInvoiceApproval(params: {
  invoiceId: string;
  workflowStatus: string; // COMPLETED | REJECTED
  actorId: string;
}) {
  const invoice = await prisma.invoice.findFirst({ where: { id: params.invoiceId, deletedAt: null } });
  if (!invoice) return;

  if (params.workflowStatus === "COMPLETED") {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        approvalStatus: "APPROVED",
        approvedAt: new Date(),
        approvedById: params.actorId,
        updatedById: params.actorId,
      },
    });
    await publishInvoiceEvent({
      eventType: "InvoiceApproved",
      actorId: params.actorId,
      entityId: invoice.id,
      payload: {
        invoiceId: invoice.id,
        invoiceCode: invoice.code,
        deliveryId: invoice.deliveryId,
        salesOrderId: invoice.salesOrderId,
        customerId: invoice.customerId,
        workflowInstanceId: invoice.workflowInstanceId,
        currency: invoice.currency,
        invoiceTotal: invoice.invoiceTotal,
        approverId: params.actorId,
      },
    }).catch(() => undefined);
    return;
  }

  if (params.workflowStatus === "REJECTED") {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { approvalStatus: "REJECTED", updatedById: params.actorId },
    });
    await publishInvoiceEvent({
      eventType: "InvoiceRejected",
      actorId: params.actorId,
      entityId: invoice.id,
      payload: {
        invoiceId: invoice.id,
        invoiceCode: invoice.code,
        deliveryId: invoice.deliveryId,
        salesOrderId: invoice.salesOrderId,
        customerId: invoice.customerId,
        workflowInstanceId: invoice.workflowInstanceId,
        currency: invoice.currency,
        invoiceTotal: invoice.invoiceTotal,
        approverId: params.actorId,
      },
    }).catch(() => undefined);
  }
}

/**
 * 条件触发：Invoice 修改影响财务结果的字段（paymentTerm/dueDate/taxProfileId）时创建或重启审批实例。
 * 规则（CTO Phase 4 指令）：
 *   - module="INVOICE" 的 ApprovalPolicy（enabled + isActive）+ 金额区间 rule（priority DESC 命中）；
 *   - 无实例 → 创建新实例；已有 RUNNING → 不重复创建（保持 PENDING，返回 skipped="instance-running"）；
 *     已有终态（COMPLETED/REJECTED/WITHDRAWN/TERMINATED）→ 复用该实例重新 SUBMIT 重启审批（approvalStatus=PENDING）；
 *   - 无策略/未命中/非财务变更 → 跳过（不阻塞编辑）；
 *   - **命中策略后创建/复用失败 → 显式抛错**（不静默），调用方主事务整体回滚并返回显式错误；
 *   - 事件发布（InvoiceApprovalStarted）在事务内发布（AuditLog 独立连接写入，失败降级不阻断主流程）。
 */
export async function maybeTriggerInvoiceApproval(params: {
  invoiceId: string;
  keyFinancialChanged: boolean;
  actorId: string;
  meta?: object;
  /** 调用方主事务客户端：传入则全部 DB 写入加入该事务（财务修改 + 审批创建原子）；不传则独立执行 */
  tx?: Prisma.TransactionClient;
}): Promise<{ triggered: boolean; instanceId?: string | null; resubmitted?: boolean; skipped?: string }> {
  if (!params.keyFinancialChanged) return { triggered: false, skipped: "no-financial-change" };

  const db = params.tx ?? prisma;
  const invoice = await db.invoice.findFirst({ where: { id: params.invoiceId, deletedAt: null } });
  if (!invoice) return { triggered: false, skipped: "not-found" };

  // ① 匹配 INVOICE 审批策略（未配置则不触发，编辑不受影响）
  const policy = await db.approvalPolicy.findFirst({
    where: { module: "INVOICE", enabled: true, isActive: true, deletedAt: null },
    orderBy: { priority: "asc" },
  });
  if (!policy) return { triggered: false, skipped: "no-policy" };
  const rules = await db.approvalPolicyRule.findMany({
    where: { policyId: policy.id, isActive: true, deletedAt: null },
    orderBy: { priority: "desc" },
  });
  const matched = rules.find((r) => {
    const loOk = r.minAmount === null || invoice.invoiceTotal.gte(new Prisma.Decimal(r.minAmount));
    const hiOk = r.maxAmount === null || invoice.invoiceTotal.lt(new Prisma.Decimal(r.maxAmount));
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
    where: { businessType: "invoice", businessId: invoice.id, deletedAt: null },
    select: { id: true, status: true },
  });

  if (existing) {
    // RUNNING：审批进行中，不重复创建，保持 PENDING
    if (existing.status === "RUNNING") {
      return { triggered: false, skipped: "instance-running", instanceId: existing.id };
    }
    // 终态（COMPLETED/REJECTED/WITHDRAWN/TERMINATED）：复用该实例重新 SUBMIT 重启审批
    await db.workflowInstance.update({
      where: { id: existing.id },
      data: { status: "RUNNING", currentStepNo: startStepNo, completedAt: null, updatedById: params.actorId },
    });
    // 重新审批前失效上一轮全部 Approver（isActive=false + deletedAt=now），防止旧 REJECTED 卡死新一轮
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
        comment: "发票财务条件变更，重新提交审批",
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
        remark: "发票财务条件变更，重新提交审批",
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
    // 回写 Invoice 投影：approvalStatus=PENDING，同时清空上一轮残留 approvedAt/approvedById
    await db.invoice.update({
      where: { id: invoice.id },
      data: { approvalStatus: "PENDING", approvedAt: null, approvedById: null, updatedById: params.actorId },
    });
    await publishInvoiceEvent({
      eventType: "InvoiceApprovalStarted",
      actorId: params.actorId,
      entityId: invoice.id,
      payload: {
        invoiceId: invoice.id,
        invoiceCode: invoice.code,
        deliveryId: invoice.deliveryId,
        salesOrderId: invoice.salesOrderId,
        customerId: invoice.customerId,
        workflowInstanceId: existing.id,
        resubmitted: true,
        currency: invoice.currency,
        invoiceTotal: invoice.invoiceTotal,
      },
      meta: params.meta,
    }).catch(() => undefined);
    return { triggered: true, instanceId: existing.id, resubmitted: true };
  }

  // ④ 无实例 → 创建新实例（与编辑同一事务：失败整体回滚，显式报错）
  const created = await db.workflowInstance.create({
    data: {
      definitionId: definition.id,
      businessType: "invoice",
      businessId: invoice.id,
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
          comment: "发票财务条件变更，触发审批",
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
          remark: "发票财务条件变更，触发审批",
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

  // ⑤ 回写 Invoice 投影：workflowInstanceId + approvalStatus=PENDING
  await db.invoice.update({
    where: { id: invoice.id },
    data: { workflowInstanceId: created.id, approvalStatus: "PENDING", updatedById: params.actorId },
  });
  await publishInvoiceEvent({
    eventType: "InvoiceApprovalStarted",
    actorId: params.actorId,
    entityId: invoice.id,
    payload: {
      invoiceId: invoice.id,
      invoiceCode: invoice.code,
      deliveryId: invoice.deliveryId,
      salesOrderId: invoice.salesOrderId,
      customerId: invoice.customerId,
      workflowInstanceId: created.id,
      resubmitted: false,
      currency: invoice.currency,
      invoiceTotal: invoice.invoiceTotal,
    },
    meta: params.meta,
  }).catch(() => undefined);
  return { triggered: true, instanceId: created.id, resubmitted: false };
}
