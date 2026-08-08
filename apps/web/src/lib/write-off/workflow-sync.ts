import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveStepApprovers } from "@/lib/workflow/engine";
import { publishWriteOffEvent } from "@/lib/write-off/events";

/**
 * Sprint 4E-2 - WriteOff ↔ Workflow 集成（Workflow 条件触发；完全对齐 Invoice workflow-sync 模式）
 * 设计依据：ADR-0021（Receipt & Payment Allocation Domain）+ CTO Design Review 97/100 拍板③：
 *   - WriteOff 独立事实实体（WriteOff + WriteOffAllocation），**不做 Revision/Snapshot 三件套**
 *     （审批历史由 Workflow、审计由 AuditLog，避免模型膨胀）；
 *   - **审批边界（CTO 锁定）**：普通 Receipt 不审批；**WriteOff 根据 ApprovalPolicy 条件触发 Workflow**；
 *     不建 WriteOffApproval 表（Workflow 唯一审批事实源）；
 *   - **Workflow APPROVED ≠ WriteOff Applied（CTO 解冻令，必须锁死）**：审批终态只回写审批投影
 *     （workflowInstanceId/approvalStatus/approvedAt/approvedById），**绝不直接修改 AR**；
 *     真正财务影响只能由显式 `POST /api/write-offs/{id}/apply` 完成（下一步实现）——避免"审批动作同时产生会计事实"，
 *     便于重试、审计与幂等控制；
 *   - **审批金额匹配差异（CTO 明确）**：ApprovalPolicy rule 按 `writeOff.amount`（= Σ WriteOffAllocation.amount）
 *     匹配金额区间，**不引用 AR.balanceAmount**（balance 是目标余额，不是本次核销金额）；
 *   - 单实例架构：WorkflowInstance @@unique([businessType, businessId]) 保持不变（businessType="write-off"）。
 */

/** 读取 WriteOff + 明细 AR 摘要（customerId/currency/accountsReceivableIds 供事件载荷） */
async function loadWriteOffWithArSummary(writeOffId: string) {
  return prisma.writeOff.findFirst({
    where: { id: writeOffId, deletedAt: null },
    include: {
      allocations: {
        where: { deletedAt: null },
        include: {
          accountsReceivable: { select: { id: true, customerId: true, currency: true } },
        },
      },
    },
  });
}

/**
 * 审批终态回写（调用方：workflows/instances/[id]/actions，businessType === "write-off"）
 * COMPLETED → approvalStatus=APPROVED + approvedAt + approvedById；REJECTED → approvalStatus=REJECTED。
 * **红线（CTO 锁死）**：审批通过 ≠ Applied——本函数只回写 WriteOff 审批投影，
 * **绝不修改 AR.writeOffAmount/balanceAmount**（财务影响由显式 Apply 动作完成）。
 * DB 事实更新不 catch（失败必须冒泡）；仅事件发布降级（.catch）。
 */
export async function syncWriteOffApproval(params: {
  writeOffId: string;
  workflowStatus: string; // COMPLETED | REJECTED
  actorId: string;
}) {
  const writeOff = await loadWriteOffWithArSummary(params.writeOffId);
  if (!writeOff) return;

  const arSummary = writeOff.allocations[0]?.accountsReceivable;
  const basePayload = {
    writeOffId: writeOff.id,
    writeOffCode: writeOff.code,
    customerId: arSummary?.customerId ?? "",
    currency: arSummary?.currency ?? "",
    amount: writeOff.amount,
    accountsReceivableIds: writeOff.allocations.map((a) => a.accountsReceivableId),
    workflowInstanceId: writeOff.workflowInstanceId,
    reason: writeOff.reason,
  };

  if (params.workflowStatus === "COMPLETED") {
    // DB 事实更新：不 catch（审批投影失败必须冒泡，不允许静默）
    await prisma.writeOff.update({
      where: { id: writeOff.id },
      data: {
        approvalStatus: "APPROVED",
        approvedAt: new Date(),
        approvedById: params.actorId,
        updatedById: params.actorId,
      },
    });
    await publishWriteOffEvent({
      eventType: "WriteOffApproved",
      actorId: params.actorId,
      entityId: writeOff.id,
      payload: { ...basePayload, approverId: params.actorId },
    }).catch(() => undefined);
    return;
  }

  if (params.workflowStatus === "REJECTED") {
    await prisma.writeOff.update({
      where: { id: writeOff.id },
      data: { approvalStatus: "REJECTED", updatedById: params.actorId },
    });
    await publishWriteOffEvent({
      eventType: "WriteOffRejected",
      actorId: params.actorId,
      entityId: writeOff.id,
      payload: { ...basePayload, approverId: params.actorId },
    }).catch(() => undefined);
  }
}

/**
 * 条件触发：WriteOff Submit 时按 WRITE_OFF 审批策略创建/复用 Workflow 实例。
 * 规则（完全复用 Invoice maybeTrigger 模式，仅业务字段替换）：
 *   - module="WRITE_OFF" 的 ApprovalPolicy（enabled + isActive）+ 金额区间 rule（priority DESC 命中）；
 *     **匹配金额 = writeOff.amount（= Σ WriteOffAllocation.amount），不引用 AR.balanceAmount**；
 *   - 无实例 → 创建新实例；已有 RUNNING → 不重复创建（保持 PENDING，返回 skipped="instance-running"）；
 *     已有终态（COMPLETED/REJECTED/WITHDRAWN/TERMINATED）→ 复用该实例重新 SUBMIT 重启审批
 *     （失效旧 Approver → 新建 PENDING Approver → approvalStatus=PENDING → approvedAt=null → approvedById=null）；
 *   - 无策略/未命中 → 跳过（不阻塞）；
 *   - **命中策略后创建/复用失败 → 显式抛错**（不静默），调用方主事务整体回滚并返回显式错误；
 *   - 事件发布（WriteOffApprovalStarted）在事务内发布（AuditLog 独立连接写入，失败降级不阻断主流程）。
 */
export async function maybeTriggerWriteOffApproval(params: {
  writeOffId: string;
  actorId: string;
  meta?: object;
  /** 调用方主事务客户端：传入则全部 DB 写入加入该事务（WriteOff 提交 + 审批创建原子）；不传则独立执行 */
  tx?: Prisma.TransactionClient;
}): Promise<{ triggered: boolean; instanceId?: string | null; resubmitted?: boolean; skipped?: string }> {
  const db = params.tx ?? prisma;
  const writeOff = await db.writeOff.findFirst({
    where: { id: params.writeOffId, deletedAt: null },
    include: { allocations: { where: { deletedAt: null } } },
  });
  if (!writeOff) return { triggered: false, skipped: "not-found" };

  const arSummary =
    writeOff.allocations.length > 0
      ? await db.accountsReceivable.findFirst({
          where: { id: writeOff.allocations[0].accountsReceivableId, deletedAt: null },
          select: { id: true, customerId: true, currency: true },
        })
      : null;

  // ① 匹配 WRITE_OFF 审批策略（未配置则不触发，WriteOff 创建/提交不受影响）
  const policy = await db.approvalPolicy.findFirst({
    where: { module: "WRITE_OFF", enabled: true, isActive: true, deletedAt: null },
    orderBy: { priority: "asc" },
  });
  if (!policy) return { triggered: false, skipped: "no-policy" };
  const rules = await db.approvalPolicyRule.findMany({
    where: { policyId: policy.id, isActive: true, deletedAt: null },
    orderBy: { priority: "desc" },
  });
  // 审批金额 = writeOff.amount（= Σ WriteOffAllocation.amount；不引用 AR.balanceAmount——CTO 明确）
  const matched = rules.find((r) => {
    const loOk = r.minAmount === null || writeOff.amount.gte(new Prisma.Decimal(r.minAmount));
    const hiOk = r.maxAmount === null || writeOff.amount.lt(new Prisma.Decimal(r.maxAmount));
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
    where: { businessType: "write-off", businessId: writeOff.id, deletedAt: null },
    select: { id: true, status: true },
  });

  const basePayload = {
    writeOffId: writeOff.id,
    writeOffCode: writeOff.code,
    customerId: arSummary?.customerId ?? "",
    currency: arSummary?.currency ?? "",
    amount: writeOff.amount,
    accountsReceivableIds: writeOff.allocations.map((a) => a.accountsReceivableId),
    reason: writeOff.reason,
  };

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
        comment: "WriteOff 关键字段变更，重新提交审批",
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
        remark: "WriteOff 关键字段变更，重新提交审批",
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
    // 回写 WriteOff 审批投影：approvalStatus=PENDING，清空上一轮残留 approvedAt/approvedById
    await db.writeOff.update({
      where: { id: writeOff.id },
      data: { approvalStatus: "PENDING", approvedAt: null, approvedById: null, updatedById: params.actorId },
    });
    await publishWriteOffEvent({
      eventType: "WriteOffApprovalStarted",
      actorId: params.actorId,
      entityId: writeOff.id,
      payload: { ...basePayload, workflowInstanceId: existing.id, resubmitted: true },
      meta: params.meta,
    }).catch(() => undefined);
    return { triggered: true, instanceId: existing.id, resubmitted: true };
  }

  // ④ 无实例 → 创建新实例（与提交同一事务：失败整体回滚，显式报错）
  const created = await db.workflowInstance.create({
    data: {
      definitionId: definition.id,
      businessType: "write-off",
      businessId: writeOff.id,
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
          comment: "WriteOff 提交审批",
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
          remark: "WriteOff 提交审批",
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

  // ⑤ 回写 WriteOff 审批投影：workflowInstanceId + approvalStatus=PENDING（不触碰 AR）
  await db.writeOff.update({
    where: { id: writeOff.id },
    data: { workflowInstanceId: created.id, approvalStatus: "PENDING", updatedById: params.actorId },
  });
  await publishWriteOffEvent({
    eventType: "WriteOffApprovalStarted",
    actorId: params.actorId,
    entityId: writeOff.id,
    payload: { ...basePayload, workflowInstanceId: created.id, resubmitted: false },
    meta: params.meta,
  }).catch(() => undefined);
  return { triggered: true, instanceId: created.id, resubmitted: false };
}
