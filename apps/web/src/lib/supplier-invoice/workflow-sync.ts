import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { resolveStepApprovers } from '@/lib/workflow/engine';

/**
 * Sprint 5C-1B - SupplierInvoice ↔ Workflow 集成（Approval 单独接 Workflow——CTO #9238/#9247 分层）
 * 设计依据：Sprint5C Gate §4.13 + Field Matrix §2.1-2.2（Approval references MatchRun，不 mutates MatchRun）+
 *           ADR-0027 + CTO #9238（Match/Approval 分层）+ #9247（run identity 绑定 + stale 校验）
 * - **Approval 与 Match 完全分层**：Match API 只推进 documentStatus → MATCHED 并创建 immutable
 *   MatchRun/MatchLine；**绝不写 approvedMatchRunId/approvedMatchRevision**；
 * - **触发审批时绑定 run identity（#9247 细节③）**：maybeTrigger 创建/复用 WorkflowInstance 时，
 *   把 matchRunId + revision 写进 SUBMIT WorkflowAction.comment（JSON）作为 workflow business context；
 * - **审批完成同步时 stale 校验（fail closed）**：sync 时校验 workflow snapshot run ==
 *   invoice.currentMatchRun 且 invoice.documentStatus == MATCHED——不一致拒绝（旧审批不得批准新 revision，
 *   re-match 后旧 workflow 永远不能误批准新 snapshot）；
 * - **Approval 成功**：approvedMatchRunId=currentMatchRunId、approvedMatchRevision=currentRun.revision
 *   固化到 SupplierInvoice（审批证据），documentStatus → APPROVED；**绝不 UPDATE MatchRun**；
 * - **红线**：APPROVED ≠ POSTED；不创建 GrirRecord/ApLiabilityFact/ApOpenItem；不写 postedAt/postedById；
 * - WorkflowInstance/WorkflowAction/WorkflowHistory 为唯一审批事实源，Invoice 仅保存审批投影；
 * - **单实例架构 + 多轮重提（对齐 PO/Transfer 模式）**：RUNNING → 不重复创建；终态 → 复用同一实例重启；
 * - **re-match 门禁（#9247 细节②）**：APPROVED 后禁直接 re-match（除非先撤回/重开审批）——Match Engine 侧门禁。
 */

const RUN_IDENTITY_COMMENT_PREFIX = 'supplier-invoice-match-run:';

/** 从 WorkflowAction.comment 解析触发审批时的 run identity（{matchRunId, revision}） */
function parseRunIdentity(comment: string | null | undefined): { matchRunId: string; revision: number } | null {
  if (!comment || !comment.startsWith(RUN_IDENTITY_COMMENT_PREFIX)) return null;
  try {
    const raw = comment.slice(RUN_IDENTITY_COMMENT_PREFIX.length);
    const parsed = JSON.parse(raw) as { matchRunId?: string; revision?: number };
    if (!parsed.matchRunId || typeof parsed.revision !== 'number') return null;
    return { matchRunId: parsed.matchRunId, revision: parsed.revision };
  } catch {
    return null;
  }
}

/**
 * 审批终态回写（调用方：workflows/instances/[id]/actions，businessType === "supplier-invoice"）
 * COMPLETED → **stale 校验（fail closed）**：workflow 触发时绑定的 run identity == invoice.currentMatchRun
 * 且 invoice.documentStatus == MATCHED → 固化 approvedMatchRunId/approvedMatchRevision + APPROVED；
 * 不一致 → 抛 SUPPLIER_INVOICE_MATCH_STALE_APPROVAL（re-match 后旧审批不得批准新 snapshot——#9247）；
 * REJECTED → 保持 MATCHED（可重新 Match 追加 revision）。
 * **绝不 UPDATE MatchRun**（Approval references MatchRun，不 mutates——#8901/#9238）。
 */
export async function syncSupplierInvoiceApproval(params: {
  invoiceId: string;
  workflowStatus: string; // COMPLETED | REJECTED
  actorId: string;
}) {
  const invoice = await prisma.supplierInvoice.findFirst({
    where: { id: params.invoiceId, deletedAt: null },
    select: { id: true, documentStatus: true, currentMatchRunId: true },
  });
  if (!invoice) return;

  if (params.workflowStatus === 'COMPLETED') {
    // ① 校验审批时绑定的 run identity（从 WorkflowInstance SUBMIT action comment 读取）
    const instance = await prisma.workflowInstance.findFirst({
      where: { businessType: 'supplier-invoice', businessId: params.invoiceId, deletedAt: null },
      select: { id: true },
    });
    let boundRunId: string | null = null;
    let boundRevision: number | null = null;
    if (instance) {
      const submitAction = await prisma.workflowAction.findFirst({
        where: { instanceId: instance.id, actionType: 'SUBMIT', deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { comment: true },
      });
      const identity = parseRunIdentity(submitAction?.comment);
      if (identity) {
        boundRunId = identity.matchRunId;
        boundRevision = identity.revision;
      }
    }

    // ② stale 校验（fail closed——#9247 细节③）
    const currentRunId = invoice.currentMatchRunId;
    if (!currentRunId || !boundRunId || boundRunId !== currentRunId) {
      throw new Error('SUPPLIER_INVOICE_MATCH_STALE_APPROVAL: 审批引用的 run 已非当前 currentMatchRun（re-match 后旧审批不得批准新 snapshot）');
    }
    if (invoice.documentStatus !== 'MATCHED') {
      throw new Error('SUPPLIER_INVOICE_MATCH_STALE_APPROVAL: 仅 MATCHED 状态可审批通过');
    }

    // ③ 固化审批证据（Approval references MatchRun——不 mutates MatchRun）
    const currentRun = await prisma.supplierInvoiceMatchRun.findFirst({
      where: { id: currentRunId, supplierInvoiceId: params.invoiceId },
      select: { revision: true },
    });
    if (!currentRun || boundRevision !== currentRun.revision) {
      throw new Error('SUPPLIER_INVOICE_MATCH_STALE_APPROVAL: 审批引用的 revision 与当前 run 不一致');
    }

    await prisma.supplierInvoice.update({
      where: { id: params.invoiceId },
      data: {
        documentStatus: 'APPROVED',
        approvedMatchRunId: currentRunId,
        approvedMatchRevision: currentRun.revision,
        updatedById: params.actorId,
      },
    });
    return;
  }

  if (params.workflowStatus === 'REJECTED') {
    // 驳回 → 保持 MATCHED（可重新 Match 追加 revision——#9247 re-match 门禁允许 MATCHED → MATCHED）
    await prisma.supplierInvoice.update({
      where: { id: params.invoiceId },
      data: {
        documentStatus: 'MATCHED',
        approvedMatchRunId: null,
        approvedMatchRevision: null,
        updatedById: params.actorId,
      },
    });
  }
}

/**
 * 条件触发：Match 成功后按 SUPPLIER_INVOICE 审批策略创建/复用 Workflow 实例。
 * 规则（完全复用 PO maybeTrigger 模式，仅业务字段替换）：
 *   - module="SUPPLIER_INVOICE" 的 ApprovalPolicy（enabled + isActive）+ 金额区间 rule（priority DESC 命中）；
 *     **匹配金额 = invoice.grossAmount（服务端聚合值）**；
 *   - **触发时把 matchRunId + revision 写入 SUBMIT WorkflowAction.comment**（workflow business context——
 *     #9247 细节③，审批完成时用此校验 stale）；
 *   - 无实例 → 创建新实例；已有 RUNNING → 不重复创建（返回 skipped="instance-running"）；
 *     已有终态（COMPLETED/REJECTED/WITHDRAWN/TERMINATED）→ 复用同一实例重新 SUBMIT 重启审批；
 *   - 无策略/未命中 → 跳过（不阻塞；发票保持 MATCHED 待后续显式处理）；
 *   - **命中策略后创建/复用失败 → 显式抛错**（不静默），调用方整体回滚并返回显式错误。
 */
export async function maybeTriggerSupplierInvoiceApproval(params: {
  invoiceId: string;
  matchRunId: string;
  revision: number;
  actorId: string;
  meta?: object;
  /** 调用方主事务客户端：传入则全部 DB 写入加入该事务；不传则独立执行 */
  tx?: Prisma.TransactionClient;
}): Promise<{ triggered: boolean; instanceId?: string | null; resubmitted?: boolean; skipped?: string }> {
  const db = params.tx ?? prisma;
  const invoice = await db.supplierInvoice.findFirst({
    where: { id: params.invoiceId, deletedAt: null },
  });
  if (!invoice) return { triggered: false, skipped: 'not-found' };

  // ① 匹配 SUPPLIER_INVOICE 审批策略（未配置则不触发，Match 结果不受影响）
  const policy = await db.approvalPolicy.findFirst({
    where: { module: 'SUPPLIER_INVOICE', enabled: true, isActive: true, deletedAt: null },
    orderBy: { priority: 'asc' },
  });
  if (!policy) return { triggered: false, skipped: 'no-policy' };
  const rules = await db.approvalPolicyRule.findMany({
    where: { policyId: policy.id, isActive: true, deletedAt: null },
    orderBy: { priority: 'desc' },
  });
  // 审批金额 = invoice.grossAmount（服务端聚合值）
  const matched = rules.find((r) => {
    const loOk = r.minAmount === null || invoice.grossAmount.gte(new Prisma.Decimal(r.minAmount));
    const hiOk = r.maxAmount === null || invoice.grossAmount.lt(new Prisma.Decimal(r.maxAmount));
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
  // ③ 触发审批时绑定 run identity（#9247 细节③——workflow business context）
  const runIdentityComment = `${RUN_IDENTITY_COMMENT_PREFIX}${JSON.stringify({ matchRunId: params.matchRunId, revision: params.revision })}`;

  // ④ 已有实例判断（单实例架构 @@unique([businessType, businessId])）
  const existing = await db.workflowInstance.findFirst({
    where: { businessType: 'supplier-invoice', businessId: invoice.id, deletedAt: null },
    select: { id: true, status: true },
  });

  if (existing) {
    if (existing.status === 'RUNNING') {
      return { triggered: false, skipped: 'instance-running', instanceId: existing.id };
    }
    // 终态：复用同一实例重新 SUBMIT 重启审批（对齐 PO/Transfer 模式）
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
        comment: runIdentityComment,
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
        remark: '供应商发票重新提交审批（新 Match revision 绑定）',
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
    return { triggered: true, instanceId: existing.id, resubmitted: true };
  }

  // ⑤ 无实例 → 创建新实例（与 Match 同一事务：失败整体回滚，显式报错）
  const created = await db.workflowInstance.create({
    data: {
      definitionId: definition.id,
      businessType: 'supplier-invoice',
      businessId: invoice.id,
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
          comment: runIdentityComment,
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
          remark: '提交供应商发票三单匹配审批',
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

  return { triggered: true, instanceId: created.id, resubmitted: false };
}
