import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { resolveStepApprovers } from '@/lib/workflow/engine';

/**
 * Sprint 6B-3 - InventoryAdjustment ↔ Workflow 集成（条件审批；对齐 PurchaseOrder/Transfer 已验证模式）
 * 设计依据：Sprint6B_Inventory_Operations_Architecture_Process_Gate.md §5 + Field Matrix v0.5 §3 + CTO 6B-3 授权
 *   - Adjustment Submit 后进入条件 Workflow（module=INVENTORY_ADJUSTMENT），**审批只改变 Adjustment 状态投影**；
 *   - **红线：APPROVED ≠ APPLIED（对齐 PO APPROVED ≠ CONFIRMED / Transfer APPROVED ≠ EXECUTED）**：
 *     Workflow COMPLETED 只回写 status=APPROVED + approvedById，**绝不自动 APPLIED**——正式落账必须显式
 *     POST /api/inventory-adjustments/{id}/apply（Shared LedgerCommand 逐行 ADJUSTMENT Movement 同事务）；
 *   - WorkflowInstance/WorkflowAction/WorkflowHistory 为唯一审批事实源，Adjustment 仅保存投影
 *     （status + approvedById）；不建 InventoryAdjustmentApproval 表；
 *   - **单实例架构 + 多轮重提（对齐 PO Phase 4B / Transfer 6B-2）**：RUNNING → 不重复创建；终态 → 复用同一实例重启；
 *   - **maker-checker（P9 Final + DB CHECK 兜底）**：approvedById/appliedById 不得 = createdById——
 *     Workflow 审批人由审批流决定（通常 ≠ 创建人），DB CHECK `approvedById <> createdById` 拒绝自审；
 *   - Adjustment 无金额：策略命中 = module=INVENTORY_ADJUSTMENT 的 enabled+isActive ApprovalPolicy（不按金额区间）。
 */

/**
 * 审批终态回写（调用方：workflows/instances/[id]/actions，businessType === "inventory-adjustment"）
 * COMPLETED → status=APPROVED + approvedById（审批通过投影，可 Apply）；
 * REJECTED → status=DRAFT（可重提）+ 清 approvedById。
 * **红线：绝不自动 APPLIED**（APPROVED ≠ APPLIED，Apply 是唯一落账入口）。
 * maker-checker：若审批人 == 创建人，DB CHECK 会拒绝（抛错冒泡，不静默）。
 */
export async function syncInventoryAdjustmentApproval(params: {
  adjustmentId: string;
  workflowStatus: string; // COMPLETED | REJECTED
  actorId: string;
}) {
  const adjustment = await prisma.inventoryAdjustment.findFirst({
    where: { id: params.adjustmentId, deletedAt: null },
  });
  if (!adjustment) return;

  if (params.workflowStatus === 'COMPLETED') {
    await prisma.inventoryAdjustment.update({
      where: { id: adjustment.id },
      data: {
        status: 'APPROVED',
        approvedById: params.actorId,
        updatedById: params.actorId,
      },
    });
    return;
  }

  if (params.workflowStatus === 'REJECTED') {
    await prisma.inventoryAdjustment.update({
      where: { id: adjustment.id },
      data: {
        status: 'DRAFT',
        approvedById: null,
        updatedById: params.actorId,
      },
    });
  }
}

/**
 * 条件触发：Adjustment Submit 时按 INVENTORY_ADJUSTMENT 审批策略创建/复用 Workflow 实例。
 * 规则（完全复用 PO/Transfer maybeTrigger 模式，仅业务字段替换；**Adjustment 无金额 → 不按金额区间匹配**）：
 *   - module="INVENTORY_ADJUSTMENT" 的 ApprovalPolicy（enabled + isActive）；
 *   - 无实例 → 创建新实例；已有 RUNNING → 不重复创建；已有终态 → 复用同一实例重新 SUBMIT 重启审批；
 *   - 无策略 → 跳过（不阻塞；Adjustment 保持 SUBMITTED 待后续显式处理）；
 *   - **命中策略后创建/复用失败 → 显式抛错**（不静默），调用方主事务整体回滚并返回显式错误。
 */
export async function maybeTriggerInventoryAdjustmentApproval(params: {
  adjustmentId: string;
  actorId: string;
  meta?: object;
  /** 调用方主事务客户端：传入则全部 DB 写入加入该事务（Adjustment 提交 + 审批创建原子）；不传则独立执行 */
  tx?: Prisma.TransactionClient;
}): Promise<{ triggered: boolean; instanceId?: string | null; resubmitted?: boolean; skipped?: string }> {
  const db = params.tx ?? prisma;
  const adjustment = await db.inventoryAdjustment.findFirst({
    where: { id: params.adjustmentId, deletedAt: null },
  });
  if (!adjustment) return { triggered: false, skipped: 'not-found' };

  // ① 匹配 INVENTORY_ADJUSTMENT 审批策略（未配置则不触发，Adjustment 提交不受影响）
  const policy = await db.approvalPolicy.findFirst({
    where: { module: 'INVENTORY_ADJUSTMENT', enabled: true, isActive: true, deletedAt: null },
    orderBy: { priority: 'asc' },
  });
  if (!policy) return { triggered: false, skipped: 'no-policy' };
  // Adjustment 无金额：不按金额区间匹配——直接取策略下第一条 active rule（priority desc）
  const rules = await db.approvalPolicyRule.findMany({
    where: { policyId: policy.id, isActive: true, deletedAt: null },
    orderBy: { priority: 'desc' },
  });
  const matched = rules[0];
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

  // ③ 已有实例判断（单实例架构 @@unique([businessType, businessId])）
  const existing = await db.workflowInstance.findFirst({
    where: { businessType: 'inventory-adjustment', businessId: adjustment.id, deletedAt: null },
    select: { id: true, status: true },
  });

  if (existing) {
    if (existing.status === 'RUNNING') {
      return { triggered: false, skipped: 'instance-running', instanceId: existing.id };
    }
    // 终态：复用同一实例重新 SUBMIT 重启审批
    await db.workflowInstance.update({
      where: { id: existing.id },
      data: { status: 'RUNNING', currentStepNo: startStepNo, completedAt: null, updatedById: params.actorId },
    });
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
        comment: '调整单关键字段变更/驳回后，重新提交审批',
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
        remark: '调整单关键字段变更/驳回后，重新提交审批',
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
    // 回写 Adjustment 审批投影：status=SUBMITTED，清残留 approvedById（不触碰 applied 字段）
    await db.inventoryAdjustment.update({
      where: { id: adjustment.id },
      data: { status: 'SUBMITTED', approvedById: null, updatedById: params.actorId },
    });
    return { triggered: true, instanceId: existing.id, resubmitted: true };
  }

  // ④ 无实例 → 创建新实例（与提交同一事务：失败整体回滚，显式报错）
  const created = await db.workflowInstance.create({
    data: {
      definitionId: definition.id,
      businessType: 'inventory-adjustment',
      businessId: adjustment.id,
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
          comment: '提交调整单审批',
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
          remark: '提交调整单审批',
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

  // ⑤ 回写 Adjustment 审批投影：status=SUBMITTED（等待审批；绝不 APPLIED）
  await db.inventoryAdjustment.update({
    where: { id: adjustment.id },
    data: { status: 'SUBMITTED', approvedById: null, updatedById: params.actorId },
  });
  return { triggered: true, instanceId: created.id, resubmitted: false };
}
