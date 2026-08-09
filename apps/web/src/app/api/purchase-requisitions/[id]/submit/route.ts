import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  authenticate,
  requirePermission,
  requestMeta,
  writeAuditLog,
  clientIp,
} from '@/lib/api-helpers';
import { ok, fail, failConflict, failNotFound, failServer } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { resolveStepApprovers } from '@/lib/workflow/engine';
import { publishPurchaseRequisitionEvent } from '@/lib/purchase-requisition/events';

export const dynamic = 'force-dynamic';

/**
 * POST /api/purchase-requisitions/:id/submit（提交审批，Action API，不 PATCH status）
 * 流程：PR → ApprovalPolicy（module=PURCHASE_REQUISITION，规则 priority DESC；PR 无金额 → 优先无金额区间约束规则）
 *       → WorkflowDefinition → WorkflowInstance → PR.workflowInstanceId → status=SUBMITTED
 * 红线（Phase 3）：Submit 后进入条件 Workflow；审批只改变 PR 审批/状态投影，**不创建 PO**（PR→PO Convert 是 PO 阶段显式动作）；
 * PR 无 Snapshot 模型（仅 Revision），不生成快照；已有审批实例（单实例架构 @@unique）→ 409 不重复创建。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // submit 映射现有动作（对齐 quotation.submit 先例：submit→:edit，不新造权限体系）
  const denied = requirePermission(user, 'purchase-requisition:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-requisition.submit');

  const { id } = await params;
  const meta = requestMeta(request);

  const pr = await prisma.purchaseRequisition.findFirst({
    where: { id, deletedAt: null },
    include: { lines: { where: { deletedAt: null } } },
  });
  if (!pr) return failNotFound(ERROR_CODES.PURCHASE_REQUISITION_NOT_FOUND, '采购申请不存在');
  if (pr.status !== 'DRAFT') {
    return failConflict(ERROR_CODES.PURCHASE_REQUISITION_INVALID_STATE, '仅 DRAFT 状态可提交审批');
  }
  if (pr.lines.length === 0) {
    return failConflict(ERROR_CODES.PURCHASE_REQUISITION_NO_LINES, '采购申请至少需要一行明细');
  }

  const actorId = user!.id;

  // ① 匹配 ApprovalPolicy（PR 无金额事实 → 规则不按金额区间匹配：优先无金额约束规则，否则取 priority DESC 首条）
  const policy = await prisma.approvalPolicy.findFirst({
    where: { module: 'PURCHASE_REQUISITION', enabled: true, isActive: true, deletedAt: null },
    orderBy: { priority: 'asc' },
  });
  const rules = policy
    ? await prisma.approvalPolicyRule.findMany({
        where: { policyId: policy.id, isActive: true, deletedAt: null },
        orderBy: { priority: 'desc' },
      })
    : [];
  const matched = rules.find((r) => r.minAmount === null && r.maxAmount === null) ?? rules[0];
  if (!matched) {
    return fail(
      ERROR_CODES.PURCHASE_REQUISITION_APPROVAL_POLICY_NOT_FOUND,
      '未匹配到采购申请审批策略（ApprovalPolicy module=PURCHASE_REQUISITION），请检查策略配置',
      409,
    );
  }

  // ② 创建 WorkflowInstance（复用 Sprint 3A Workflow Engine：ACTIVE 定义 + 首步审批人解析）
  let instance: { id: string } | null = null;
  try {
    instance = await prisma
      .$transaction(async (tx) => {
        const definition = await tx.workflowDefinition.findFirst({
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

        const dup = await tx.workflowInstance.findFirst({
          where: { businessType: 'purchase-requisition', businessId: id, deletedAt: null },
          select: { id: true },
        });
        if (dup) throw new Error('WORKFLOW_INSTANCE_EXISTS');

        const firstStep = definition.steps[0];
        const startStepNo = firstStep?.stepNo ?? 1;
        const created = await tx.workflowInstance.create({
          data: {
            definitionId: definition.id,
            businessType: 'purchase-requisition',
            businessId: id,
            currentStepNo: startStepNo,
            startedBy: actorId,
            status: 'RUNNING',
            createdById: actorId,
            updatedById: actorId,
            actions: {
              create: {
                actionType: 'SUBMIT',
                actorId,
                stepNo: startStepNo,
                comment: '提交采购申请审批',
                createdById: actorId,
                updatedById: actorId,
              },
            },
            history: {
              create: {
                stepNo: startStepNo,
                actionType: 'SUBMIT',
                beforeStatus: null,
                afterStatus: 'RUNNING',
                actorId,
                ip: clientIp(request) ?? null,
                remark: '提交采购申请审批',
                createdById: actorId,
                updatedById: actorId,
              },
            },
          },
        });

        if (firstStep) {
          const userIds = await resolveStepApprovers(
            tx,
            firstStep.approverType,
            firstStep.approverValue,
          );
          if (userIds.length > 0) {
            await tx.approver.createMany({
              data: userIds.map((uid) => ({
                instanceId: created.id,
                stepNo: firstStep.stepNo,
                userId: uid,
                status: 'PENDING',
                createdById: actorId,
                updatedById: actorId,
              })),
            });
          }
        }

        // ③ 回写 PR 投影：workflowInstanceId + status=SUBMITTED（只改审批/状态投影；不创建 PO）
        await tx.purchaseRequisition.update({
          where: { id },
          data: { workflowInstanceId: created.id, status: 'SUBMITTED', updatedById: actorId },
        });
        return created;
      })
      .catch((e: Error) => {
        if (e.message === 'WORKFLOW_DEFINITION_NOT_FOUND') {
          throw new Error(ERROR_CODES.PURCHASE_REQUISITION_WORKFLOW_FAILED);
        }
        if (e.message === 'WORKFLOW_INSTANCE_EXISTS') {
          throw new Error(ERROR_CODES.WORKFLOW_INSTANCE_EXISTS);
        }
        throw e;
      });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'UNKNOWN';
    if (msg === ERROR_CODES.PURCHASE_REQUISITION_WORKFLOW_FAILED) {
      return fail(
        ERROR_CODES.PURCHASE_REQUISITION_WORKFLOW_FAILED,
        '工作流定义不存在或未发布（PURCHASE_REQUISITION_APPROVAL）',
        409,
      );
    }
    if (msg === ERROR_CODES.WORKFLOW_INSTANCE_EXISTS) {
      return failConflict(ERROR_CODES.WORKFLOW_INSTANCE_EXISTS, '该采购申请已存在审批实例');
    }
    console.error('[purchase-requisition.submit] workflow failed:', e);
    return failServer('创建审批实例失败');
  }

  if (!instance) return failServer('创建审批实例失败');

  await publishPurchaseRequisitionEvent({
    eventType: 'PurchaseRequisitionSubmitted',
    actorId,
    entityId: id,
    payload: {
      requisitionId: id,
      requisitionCode: pr.code,
      requesterId: pr.requesterId,
      departmentId: pr.departmentId,
      workflowInstanceId: instance.id,
      submittedBy: actorId,
      submittedAt: new Date().toISOString(),
    },
    meta,
  }).catch(() => undefined);
  await writeAuditLog({
    actorId,
    action: 'purchase-requisition.submit',
    entityType: 'purchase-requisition',
    entityId: id,
    afterData: { workflowInstanceId: instance.id },
    ...meta,
  });

  return ok({ id, status: 'SUBMITTED', workflowInstanceId: instance.id });
}
