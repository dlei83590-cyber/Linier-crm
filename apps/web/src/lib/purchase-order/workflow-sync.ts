import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { resolveStepApprovers } from '@/lib/workflow/engine';
import { publishPurchaseOrderEvent } from '@/lib/purchase-order/events';

/**
 * Sprint 5A - PurchaseOrder ↔ Workflow 集成（条件审批；完全对齐 WriteOff/Invoice 已验证模式）
 * 设计依据：ADR-0023（Approved with Changes）+ CTO Phase 4B 指令：
 *   - PO Submit 后进入条件 Workflow（module=PURCHASE_ORDER），**审批只改变 PO 审批/状态投影**；
 *   - **红线：APPROVED ≠ CONFIRMED（CTO 拍板调整③，Phase 4B 再次锁死）**：Workflow COMPLETED
 *     只回写 approvalStatus=APPROVED + status=APPROVED，**绝不自动 CONFIRMED**——正式下单必须显式
 *     POST /api/purchase-orders/{id}/confirm；只有 Confirmed PO 才是 5B GR 来源；
 *   - WorkflowInstance/WorkflowAction/WorkflowHistory 为唯一审批事实源，PO 仅保存投影
 *     （workflowInstanceId / approvalStatus / approvedAt / approvedById）；不建 PurchaseOrderApproval 表；
 *   - **单实例架构 + 多轮重提（CTO Phase 4B 指令）**：@@unique([businessType, businessId]) 不变；
 *     RUNNING → 不重复创建；终态（COMPLETED/REJECTED/WITHDRAWN/TERMINATED）→ **复用同一实例重启**
 *     （失效旧 Approver → 重置 RUNNING + currentStep 首步 + completedAt=null → 新建 PENDING Approver →
 *     回写 approvalStatus=PENDING + 清 approvedAt/approvedById → 新一轮 SUBMIT Action/History）；
 *   - 审批金额匹配：ApprovalPolicy rule 按 PO.totalAmount 金额区间命中（PO = 采购承诺事实源）；
 *   - PurchaseOrderSnapshot 唯一约束已放宽为 [purchaseOrderId, snapshotType, revisionNo]
 *     （Migration 0022：多轮审批同 snapshotType 可并存——Phase 4B 前 Schema 风险修复）。
 */

/**
 * 审批终态回写（调用方：workflows/instances/[id]/actions，businessType === "purchase-order"）
 * COMPLETED → status=APPROVED + approvalStatus=APPROVED + approvedAt + approvedById；
 * REJECTED → status=DRAFT（可重提）+ approvalStatus=REJECTED。
 * **红线：绝不自动 CONFIRMED**（APPROVED ≠ CONFIRMED）；不生成快照（快照由 confirm/cancel 显式生成）。
 * DB 事实更新不 catch（失败必须冒泡）；仅事件发布降级（.catch）。
 */
export async function syncPurchaseOrderApproval(params: {
  purchaseOrderId: string;
  workflowStatus: string; // COMPLETED | REJECTED
  actorId: string;
}) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: params.purchaseOrderId, deletedAt: null },
  });
  if (!po) return;

  if (params.workflowStatus === 'COMPLETED') {
    await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: {
        status: 'APPROVED',
        approvalStatus: 'APPROVED',
        approvedAt: new Date(),
        approvedById: params.actorId,
        updatedById: params.actorId,
      },
    });
    await publishPurchaseOrderEvent({
      eventType: 'PurchaseOrderApproved',
      actorId: params.actorId,
      entityId: po.id,
      payload: {
        purchaseOrderId: po.id,
        purchaseOrderCode: po.code,
        sourceType: po.sourceType,
        supplierId: po.supplierId,
        requisitionId: po.requisitionId,
        currency: po.currency,
        totalAmount: po.totalAmount.toString(),
        workflowInstanceId: po.workflowInstanceId,
        approvedBy: params.actorId,
        approvedAt: new Date().toISOString(),
      },
    }).catch(() => undefined);
    return;
  }

  if (params.workflowStatus === 'REJECTED') {
    // 驳回 → DRAFT 重提（对齐 PR 模式）
    await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: {
        status: 'DRAFT',
        approvalStatus: 'REJECTED',
        approvedAt: null,
        approvedById: null,
        updatedById: params.actorId,
      },
    });
    await publishPurchaseOrderEvent({
      eventType: 'PurchaseOrderRejected',
      actorId: params.actorId,
      entityId: po.id,
      payload: {
        purchaseOrderId: po.id,
        purchaseOrderCode: po.code,
        sourceType: po.sourceType,
        supplierId: po.supplierId,
        requisitionId: po.requisitionId,
        currency: po.currency,
        totalAmount: po.totalAmount.toString(),
        workflowInstanceId: po.workflowInstanceId,
        rejectedBy: params.actorId,
        rejectedAt: new Date().toISOString(),
      },
    }).catch(() => undefined);
  }
}

/**
 * 条件触发：PO Submit 时按 PURCHASE_ORDER 审批策略创建/复用 Workflow 实例。
 * 规则（完全复用 WriteOff maybeTrigger 模式，仅业务字段替换）：
 *   - module="PURCHASE_ORDER" 的 ApprovalPolicy（enabled + isActive）+ 金额区间 rule（priority DESC 命中）；
 *     **匹配金额 = po.totalAmount（服务端 Decimal，不引用其他余额）**；
 *   - 无实例 → 创建新实例；已有 RUNNING → 不重复创建（返回 skipped="instance-running"）；
 *     已有终态（COMPLETED/REJECTED/WITHDRAWN/TERMINATED）→ **复用同一实例重新 SUBMIT 重启审批**
 *     （失效旧 Approver → 重置 RUNNING + currentStep 首步 + completedAt=null → 新建 PENDING Approver →
 *     approvalStatus=PENDING + 清 approvedAt/approvedById → 新一轮 SUBMIT Action/History）；
 *   - 无策略/未命中 → 跳过（不阻塞；PO 保持 SUBMITTED 待后续显式处理）；
 *   - **命中策略后创建/复用失败 → 显式抛错**（不静默），调用方主事务整体回滚并返回显式错误；
 *   - 事件发布（PurchaseOrderApprovalStarted）在事务内发布（AuditLog 独立连接写入，失败降级不阻断主流程）。
 */
export async function maybeTriggerPurchaseOrderApproval(params: {
  purchaseOrderId: string;
  actorId: string;
  meta?: object;
  /** 调用方主事务客户端：传入则全部 DB 写入加入该事务（PO 提交 + 审批创建原子）；不传则独立执行 */
  tx?: Prisma.TransactionClient;
}): Promise<{ triggered: boolean; instanceId?: string | null; resubmitted?: boolean; skipped?: string }> {
  const db = params.tx ?? prisma;
  const po = await db.purchaseOrder.findFirst({
    where: { id: params.purchaseOrderId, deletedAt: null },
  });
  if (!po) return { triggered: false, skipped: 'not-found' };

  // ① 匹配 PURCHASE_ORDER 审批策略（未配置则不触发，PO 提交不受影响）
  const policy = await db.approvalPolicy.findFirst({
    where: { module: 'PURCHASE_ORDER', enabled: true, isActive: true, deletedAt: null },
    orderBy: { priority: 'asc' },
  });
  if (!policy) return { triggered: false, skipped: 'no-policy' };
  const rules = await db.approvalPolicyRule.findMany({
    where: { policyId: policy.id, isActive: true, deletedAt: null },
    orderBy: { priority: 'desc' },
  });
  // 审批金额 = po.totalAmount（服务端聚合值，不引用其他余额）
  const matched = rules.find((r) => {
    const loOk = r.minAmount === null || po.totalAmount.gte(new Prisma.Decimal(r.minAmount));
    const hiOk = r.maxAmount === null || po.totalAmount.lt(new Prisma.Decimal(r.maxAmount));
    return loOk && hiOk;
  });
  if (!matched) return { triggered: false, skipped: 'no-rule-matched' };

  // ② 工作流定义（ACTIVE）：缺失视为配置错误，命中策略后必须显式报错（不静默）
  const definition = await db.workflowDefinition.findFirst({
    where: { id: matched.workflowDefinitionId, deletedAt: null, status: 'ACTIVE' },
    include: {
      steps: {
        where: { deletedAt: null },
        orderBy: { stepNo: 'asc' },
        include: { conditions: { where: { deletedAt: null } } },
      },
    },
  });
  if (!definition) throw new Error('WORKFLOW_DEFINITION_NOT_FOUND');

  const firstStep = definition.steps[0];
  const startStepNo = firstStep?.stepNo ?? 1;

  // ③ 已有实例判断（单实例架构 @@unique([businessType, businessId])，不修改唯一约束）
  const existing = await db.workflowInstance.findFirst({
    where: { businessType: 'purchase-order', businessId: po.id, deletedAt: null },
    select: { id: true, status: true },
  });

  const basePayload = {
    purchaseOrderId: po.id,
    purchaseOrderCode: po.code,
    sourceType: po.sourceType,
    supplierId: po.supplierId,
    requisitionId: po.requisitionId,
    currency: po.currency,
    totalAmount: po.totalAmount.toString(),
  };

  if (existing) {
    // RUNNING：审批进行中，不重复创建，保持 PENDING
    if (existing.status === 'RUNNING') {
      return { triggered: false, skipped: 'instance-running', instanceId: existing.id };
    }
    // 终态（COMPLETED/REJECTED/WITHDRAWN/TERMINATED）：复用同一实例重新 SUBMIT 重启审批
    await db.workflowInstance.update({
      where: { id: existing.id },
      data: { status: 'RUNNING', currentStepNo: startStepNo, completedAt: null, updatedById: params.actorId },
    });
    // 重新审批前失效上一轮全部 Approver（isActive=false + deletedAt=now），防止旧 REJECTED 卡死新一轮
    await db.approver.updateMany({
      where: { instanceId: existing.id, deletedAt: null },
      data: { isActive: false, deletedAt: new Date(), updatedById: params.actorId },
    });
    await db.workflowAction.create({
      data: {
        instanceId: existing.id,
        actionType: 'SUBMIT',
        actorId: params.actorId,
        stepNo: startStepNo,
        comment: '采购订单关键字段变更/驳回后，重新提交审批',
        createdById: params.actorId,
        updatedById: params.actorId,
      },
    });
    await db.workflowHistory.create({
      data: {
        instanceId: existing.id,
        stepNo: startStepNo,
        actionType: 'SUBMIT',
        beforeStatus: null,
        afterStatus: 'RUNNING',
        actorId: params.actorId,
        remark: '采购订单关键字段变更/驳回后，重新提交审批',
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
            status: 'PENDING',
            createdById: params.actorId,
            updatedById: params.actorId,
          })),
        });
      }
    }
    // 回写 PO 审批投影：approvalStatus=PENDING，清空上一轮残留 approvedAt/approvedById（不触碰 status 以外字段）
    await db.purchaseOrder.update({
      where: { id: po.id },
      data: { approvalStatus: 'PENDING', approvedAt: null, approvedById: null, updatedById: params.actorId },
    });
    await publishPurchaseOrderEvent({
      eventType: 'PurchaseOrderApprovalStarted',
      actorId: params.actorId,
      entityId: po.id,
      payload: { ...basePayload, workflowInstanceId: existing.id, resubmitted: true },
      meta: params.meta,
    }).catch(() => undefined);
    return { triggered: true, instanceId: existing.id, resubmitted: true };
  }

  // ④ 无实例 → 创建新实例（与提交同一事务：失败整体回滚，显式报错）
  const created = await db.workflowInstance.create({
    data: {
      definitionId: definition.id,
      businessType: 'purchase-order',
      businessId: po.id,
      currentStepNo: startStepNo,
      startedBy: params.actorId,
      status: 'RUNNING',
      createdById: params.actorId,
      updatedById: params.actorId,
      actions: {
        create: {
          actionType: 'SUBMIT',
          actorId: params.actorId,
          stepNo: startStepNo,
          comment: '提交采购订单审批',
          createdById: params.actorId,
          updatedById: params.actorId,
        },
      },
      history: {
        create: {
          stepNo: startStepNo,
          actionType: 'SUBMIT',
          beforeStatus: null,
          afterStatus: 'RUNNING',
          actorId: params.actorId,
          remark: '提交采购订单审批',
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
          status: 'PENDING',
          createdById: params.actorId,
          updatedById: params.actorId,
        })),
      });
    }
  }

  // ⑤ 回写 PO 审批投影：workflowInstanceId + approvalStatus=PENDING（不触碰 status；不 CONFIRMED）
  await db.purchaseOrder.update({
    where: { id: po.id },
    data: { workflowInstanceId: created.id, approvalStatus: 'PENDING', updatedById: params.actorId },
  });
  await publishPurchaseOrderEvent({
    eventType: 'PurchaseOrderApprovalStarted',
    actorId: params.actorId,
    entityId: po.id,
    payload: { ...basePayload, workflowInstanceId: created.id, resubmitted: false },
    meta: params.meta,
  }).catch(() => undefined);
  return { triggered: true, instanceId: created.id, resubmitted: false };
}
