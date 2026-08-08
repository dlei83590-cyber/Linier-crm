import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveStepApprovers } from "@/lib/workflow/engine";
import { publishCreditDebitNoteEvent } from "@/lib/credit-debit-note/events";

/**
 * Sprint 4E-3 - CreditDebitNote ↔ Workflow 集成（Workflow 条件触发；完全对齐 WriteOff workflow-sync 模式）
 * 设计依据：ADR-0022（Credit Note / Debit Note Domain）+ CTO Design Review 98/100 拍板③：
 *   - **条件审批**：复用 ApprovalPolicy(module="CREDIT_DEBIT_NOTE") 选择 Workflow，不建 Approval 表
 *     （Workflow 唯一审批事实源）；
 *   - **Workflow APPROVED ≠ Note Applied（红线锁死）**：审批终态只回写审批投影
 *     （workflowInstanceId/approvalStatus/approvedAt/approvedById），**绝不直接修改 AR**；
 *     真正财务影响只能由显式 Apply 事务完成（InvoiceAdjustment 唯一入口）——避免"审批动作同时产生会计事实"；
 *   - **审批金额匹配**：ApprovalPolicy rule 按 `note.adjustmentTotal`（= Σ CreditDebitNoteLine.totalAmount）
 *     匹配金额区间，**不引用 AR.balanceAmount**（balance 是目标余额，不是本次调整金额）；
 *   - 单实例架构：WorkflowInstance @@unique([businessType, businessId]) 保持不变（businessType="credit-debit-note"）。
 *   - **Phase 3 边界**：本文件仅提供条件触发（maybeTriggerCreditDebitNoteApproval）供 Submit 调用；
 *     审批终态回写（sync）与 workflow actions 路由接入在 Workflow 阶段实现，本阶段不接入。
 */

/**
 * 条件触发：CreditDebitNote Submit 时按 CREDIT_DEBIT_NOTE 审批策略创建/复用 Workflow 实例。
 * 规则（完全复用 WriteOff maybeTrigger 模式，仅业务字段替换）：
 *   - module="CREDIT_DEBIT_NOTE" 的 ApprovalPolicy（enabled + isActive）+ 金额区间 rule（priority DESC 命中）；
 *     **匹配金额 = note.adjustmentTotal（= Σ lines.totalAmount），不引用 AR.balanceAmount**；
 *   - 无实例 → 创建新实例；已有 RUNNING → 不重复创建（保持 PENDING，返回 skipped="instance-running"）；
 *     已有终态（COMPLETED/REJECTED/WITHDRAWN/TERMINATED）→ 复用该实例重新 SUBMIT 重启审批
 *     （失效旧 Approver → 新建 PENDING Approver → approvalStatus=PENDING → approvedAt=null → approvedById=null）；
 *   - 无策略/未命中 → 跳过（不阻塞；Submit 保持 SUBMITTED，可直接进入可 Apply 状态）；
 *   - **命中策略后创建/复用失败 → 显式抛错**（不静默），调用方主事务整体回滚（映射 CN_DN_WORKFLOW_FAILED）；
 *   - **绝不修改 AR.adjustedAmount**（红线：审批只回写投影）；
 *   - 事件发布（CreditDebitNoteApprovalStarted）在事务内发布（AuditLog 独立连接写入，失败降级不阻断主流程）。
 */
export async function maybeTriggerCreditDebitNoteApproval(params: {
  noteId: string;
  actorId: string;
  meta?: object;
  /** 调用方主事务客户端：传入则全部 DB 写入加入该事务（Submit + 审批创建原子）；不传则独立执行 */
  tx?: Prisma.TransactionClient;
}): Promise<{ triggered: boolean; instanceId?: string | null; resubmitted?: boolean; skipped?: string }> {
  const db = params.tx ?? prisma;
  const note = await db.creditDebitNote.findFirst({
    where: { id: params.noteId, deletedAt: null },
  });
  if (!note) return { triggered: false, skipped: "not-found" };

  // ① 匹配 CREDIT_DEBIT_NOTE 审批策略（未配置则不触发，Create/Submit 不受影响）
  const policy = await db.approvalPolicy.findFirst({
    where: { module: "CREDIT_DEBIT_NOTE", enabled: true, isActive: true, deletedAt: null },
    orderBy: { priority: "asc" },
  });
  if (!policy) return { triggered: false, skipped: "no-policy" };
  const rules = await db.approvalPolicyRule.findMany({
    where: { policyId: policy.id, isActive: true, deletedAt: null },
    orderBy: { priority: "desc" },
  });
  // 审批金额 = note.adjustmentTotal（= Σ lines.totalAmount；不引用 AR.balanceAmount——CTO 明确）
  const matched = rules.find((r) => {
    const loOk = r.minAmount === null || note.adjustmentTotal.gte(new Prisma.Decimal(r.minAmount));
    const hiOk = r.maxAmount === null || note.adjustmentTotal.lt(new Prisma.Decimal(r.maxAmount));
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
    where: { businessType: "credit-debit-note", businessId: note.id, deletedAt: null },
    select: { id: true, status: true },
  });

  const basePayload = {
    noteId: note.id,
    noteCode: note.code,
    noteType: note.noteType,
    sourceInvoiceId: note.sourceInvoiceId,
    customerId: note.customerId,
    currency: note.currency,
    adjustmentTotal: note.adjustmentTotal,
    reason: note.reason,
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
        comment: "CreditDebitNote 重新提交审批",
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
        remark: "CreditDebitNote 重新提交审批",
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
    // 回写审批投影：approvalStatus=PENDING，清空上一轮残留 approvedAt/approvedById（**不触碰 AR**）
    await db.creditDebitNote.update({
      where: { id: note.id },
      data: { approvalStatus: "PENDING", approvedAt: null, approvedById: null, updatedById: params.actorId },
    });
    await publishCreditDebitNoteEvent({
      eventType: "CreditDebitNoteApprovalStarted",
      actorId: params.actorId,
      entityId: note.id,
      payload: { ...basePayload, workflowInstanceId: existing.id, resubmitted: true },
      meta: params.meta,
    }).catch(() => undefined);
    return { triggered: true, instanceId: existing.id, resubmitted: true };
  }

  // ④ 无实例 → 创建新实例（与 Submit 同一事务：失败整体回滚，显式报错）
  const created = await db.workflowInstance.create({
    data: {
      definitionId: definition.id,
      businessType: "credit-debit-note",
      businessId: note.id,
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
          comment: "CreditDebitNote 提交审批",
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
          remark: "CreditDebitNote 提交审批",
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

  // ⑤ 回写审批投影：workflowInstanceId + approvalStatus=PENDING（**不触碰 AR.adjustedAmount**）
  await db.creditDebitNote.update({
    where: { id: note.id },
    data: { workflowInstanceId: created.id, approvalStatus: "PENDING", updatedById: params.actorId },
  });
  await publishCreditDebitNoteEvent({
    eventType: "CreditDebitNoteApprovalStarted",
    actorId: params.actorId,
    entityId: note.id,
    payload: { ...basePayload, workflowInstanceId: created.id, resubmitted: false },
    meta: params.meta,
  }).catch(() => undefined);
  return { triggered: true, instanceId: created.id, resubmitted: false };
}
