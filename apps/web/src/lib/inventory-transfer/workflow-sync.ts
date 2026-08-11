import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { resolveStepApprovers } from '@/lib/workflow/engine';
import { publishInventoryTransferEvent } from '@/lib/inventory-transfer/events';

/**
 * Sprint 6B-2 - InventoryTransfer ↔ Workflow 集成（条件审批；对齐 PurchaseOrder/WriteOff 已验证模式）
 * 设计依据：Sprint6B_Inventory_Operations_Architecture_Process_Gate.md §3 + ADR-0026 D2 + CTO 6B-2 授权
 *   - Transfer Submit 后进入条件 Workflow（module=INVENTORY_TRANSFER），**审批只改变 Transfer 状态投影**；
 *   - **红线：APPROVED ≠ EXECUTED（对齐 PO APPROVED ≠ CONFIRMED）**：Workflow COMPLETED 只回写
 *     status=APPROVED + approvedById，**绝不自动 EXECUTED**——正式执行必须显式
 *     POST /api/inventory-transfers/{id}/execute；只有 EXECUTE（Shared LedgerCommand 双 atom 同事务）才落账；
 *   - WorkflowInstance/WorkflowAction/WorkflowHistory 为唯一审批事实源，Transfer 仅保存投影
 *     （status + approvedById）；不建 InventoryTransferApproval 表；
 *   - **单实例架构 + 多轮重提（对齐 PO Phase 4B）**：RUNNING → 不重复创建；终态 → 复用同一实例重启
 *     （失效旧 Approver → 重置 RUNNING + currentStep 首步 + completedAt=null → 新建 PENDING Approver →
 *     status=SUBMITTED + 清 approvedById → 新一轮 SUBMIT Action/History）；
 *   - Transfer 无金额：策略命中 = module=INVENTORY_TRANSFER 的 enabled+isActive ApprovalPolicy（不按金额区间）。
 */

/**
 * 审批终态回写（调用方：workflows/instances/[id]/actions，businessType === "inventory-transfer"）
 * COMPLETED → status=APPROVED + approvedById（审批通过投影，可 Execute）；
 * REJECTED → status=DRAFT（可重提）+ 清 approvedById。
 * **红线：绝不自动 EXECUTED**（APPROVED ≠ EXECUTED，Execute 是唯一落账入口）。
 * DB 事实更新不 catch（失败必须冒泡）；仅事件发布降级（.catch）。
 */
export async function syncInventoryTransferApproval(params: {
  transferId: string;
  workflowStatus: string; // COMPLETED | REJECTED
  actorId: string;
}) {
  const transfer = await prisma.inventoryTransfer.findFirst({
    where: { id: params.transferId, deletedAt: null },
  });
  if (!transfer) return;

  if (params.workflowStatus === 'COMPLETED') {
    await prisma.inventoryTransfer.update({
      where: { id: transfer.id },
      data: {
        status: 'APPROVED',
        approvedById: params.actorId,
        updatedById: params.actorId,
      },
    });
    return;
  }

  if (params.workflowStatus === 'REJECTED') {
    // 驳回 → DRAFT 重提（对齐 PO 模式）
    await prisma.inventoryTransfer.update({
      where: { id: transfer.id },
      data: {
        status: 'DRAFT',
        approvedById: null,
        updatedById: params.actorId,
      },
    });
  }
}

/**
 * 条件触发：Transfer Submit 时按 INVENTORY_TRANSFER 审批策略创建/复用 Workflow 实例。
 * 规则（完全复用 PO maybeTrigger 模式，仅业务字段替换；**Transfer 无金额 → 不按金额区间匹配**）：
 *   - module="INVENTORY_TRANSFER" 的 ApprovalPolicy（enabled + isActive）；
 *   - 无实例 → 创建新实例；已有 RUNNING → 不重复创建（返回 skipped="instance-running"）；
 *     已有终态 → **复用同一实例重新 SUBMIT 重启审批**（失效旧 Approver → 重置 RUNNING + currentStep 首步 +
 *     completedAt=null → 新建 PENDING Approver → status=SUBMITTED + 清 approvedById → 新一轮 SUBMIT Action/History）；
 *   - 无策略 → 跳过（不阻塞；Transfer 保持 SUBMITTED 待后续显式处理）；
 *   - **命中策略后创建/复用失败 → 显式抛错**（不静默），调用方主事务整体回滚并返回显式错误。
 */
export async function maybeTriggerInventoryTransferApproval(params: {
  transferId: string;
  actorId: string;
  meta?: object;
  /** 调用方主事务客户端：传入则全部 DB 写入加入该事务（Transfer 提交 + 审批创建原子）；不传则独立执行 */
  tx?: Prisma.TransactionClient;
}): Promise<{ triggered: boolean; instanceId?: string | null; resubmitted?: boolean; skipped?: string }> {
  const db = params.tx ?? prisma;
  const transfer = await db.inventoryTransfer.findFirst({
    where: { id: params.transferId, deletedAt: null },
  });
  if (!transfer) return { triggered: false, skipped: 'not-found' };

  // ① 匹配 INVENTORY_TRANSFER 审批策略（未配置则不触发，Transfer 提交不受影响）
  const policy = await db.approvalPolicy.findFirst({
    where: { module: 'INVENTORY_TRANSFER', enabled: true, isActive: true, deletedAt: null },
    orderBy: { priority: 'asc' },
  });
  if (!policy) return { triggered: false, skipped: 'no-policy' };
  // Transfer 无金额：不按金额区间匹配——直接取策略下第一条 active rule（priority desc）
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
    where: { businessType: 'inventory-transfer', businessId: transfer.id, deletedAt: null },
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
        comment: '调拨单关键字段变更/驳回后，重新提交审批',
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
        remark: '调拨单关键字段变更/驳回后，重新提交审批',
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
    // 回写 Transfer 审批投影：status=SUBMITTED，清残留 approvedById（不触碰 movementGroupId/executed 字段）
    await db.inventoryTransfer.update({
      where: { id: transfer.id },
      data: { status: 'SUBMITTED', approvedById: null, updatedById: params.actorId },
    });
    return { triggered: true, instanceId: existing.id, resubmitted: true };
  }

  // ④ 无实例 → 创建新实例（与提交同一事务：失败整体回滚，显式报错）
  const created = await db.workflowInstance.create({
    data: {
      definitionId: definition.id,
      businessType: 'inventory-transfer',
      businessId: transfer.id,
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
          comment: '提交调拨单审批',
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
          remark: '提交调拨单审批',
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

  // ⑤ 回写 Transfer 审批投影：status=SUBMITTED（等待审批；绝不 EXECUTED）
  await db.inventoryTransfer.update({
    where: { id: transfer.id },
    data: { status: 'SUBMITTED', approvedById: null, updatedById: params.actorId },
  });
  return { triggered: true, instanceId: created.id, resubmitted: false };
}
