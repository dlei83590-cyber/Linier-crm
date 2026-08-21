import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { publishPurchaseRequisitionEvent } from '@/lib/purchase-requisition/events';

export const dynamic = 'force-dynamic';

/**
 * POST /api/purchase-requisitions/:id/submit —— DRAFT → APPROVED（auto-approve：移除审核，提交即生效——后续审核打通后恢复 SUBMITTED + 审批）
 * - 校验：仅 DRAFT；至少一条有效 Line
 * - **auto-approve（移除审核）**：DRAFT → APPROVED 同事务（approvalStatus=APPROVED + approvedAt/approvedById=提交人），
 *   跳过 ApprovalPolicy 匹配与 WorkflowInstance 创建（不再报 PURCHASE_REQUISITION_APPROVAL_POLICY_NOT_FOUND）
 * - **红线（Phase 3）**：提交只改变 PR 审批/状态投影，**不创建 PO**（PR→PO Convert 是 PO 阶段显式动作，convert 门禁 status=APPROVED——auto-approve 后可直接 convert）
 * - 事件：PurchaseRequisitionSubmitted（失败降级不阻断）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // submit 映射现有动作（对齐 quotation.submit 先例：submit→:edit，不新造权限体系）
  const denied = requirePermission(user, 'purchase-requisition:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-requisition.submit');

  const { id } = await params;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const pr = await prisma.purchaseRequisition.findFirst({
    where: { id, deletedAt: null },
    include: { lines: { where: { deletedAt: null } } },
  });
  if (!pr) return failNotFound(ERROR_CODES.PURCHASE_REQUISITION_NOT_FOUND, '采购申请不存在');
  if (pr.status !== 'DRAFT') {
    return failConflict(ERROR_CODES.PURCHASE_REQUISITION_INVALID_STATE, '仅 DRAFT 状态可提交');
  }
  if (pr.lines.length === 0) {
    return failConflict(ERROR_CODES.PURCHASE_REQUISITION_NO_LINES, '采购申请至少需要一行明细');
  }

  // auto-approve（移除审核：提交即生效——DRAFT → APPROVED 同事务，跳过 ApprovalPolicy 匹配与 WorkflowInstance 创建）
  const updated = await prisma.purchaseRequisition.update({
    where: { id },
    data: {
      status: 'APPROVED',
      approvalStatus: 'APPROVED',
      approvedAt: new Date(),
      approvedById: actorId,
      updatedById: actorId,
    },
  });

  await publishPurchaseRequisitionEvent({
    eventType: 'PurchaseRequisitionSubmitted',
    actorId,
    entityId: id,
    payload: {
      requisitionId: id,
      requisitionCode: pr.code,
      requesterId: pr.requesterId,
      departmentId: pr.departmentId,
      workflowInstanceId: null,
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
    beforeData: { status: 'DRAFT' },
    afterData: { status: updated.status, approvalStatus: updated.approvalStatus },
    ...meta,
  });

  return ok({
    id,
    status: updated.status,
    approvalStatus: updated.approvalStatus,
    workflowSkipped: 'no-policy' as const,
    resubmitted: false,
  });
}
