import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { maybeTriggerPurchaseOrderApproval } from '@/lib/purchase-order/workflow-sync';
import { publishPurchaseOrderEvent } from '@/lib/purchase-order/events';

export const dynamic = 'force-dynamic';

/**
 * POST /api/purchase-orders/:id/submit —— DRAFT → SUBMITTED（CTO Phase 4B）
 * - 校验（CTO Phase 4B Submit 规则）：仅 DRAFT；至少一条有效 Line；quantity>0；金额服务端重算一致；
 *   Supplier 有效；Direct/Requisition 来源一致性（REQUISITION 必带 requisitionId；行溯源已由 PATCH 校验过，此处复核）
 * - 命中 ApprovalPolicy(module=PURCHASE_ORDER) → 创建/复用 WorkflowInstance（单实例 + 多轮重提：失效旧 Approver、
 *   重置 RUNNING + currentStep 首步 + completedAt=null → 新建 PENDING Approver → approvalStatus=PENDING +
 *   清 approvedAt/approvedById → 新一轮 SUBMIT Action/History）
 * - 未命中策略 → **直接完成审批投影**（status=APPROVED + approvalStatus=APPROVED + approvedAt/approvedById=提交人，
 *   生成 APPROVED Snapshot）——对齐 CTO Phase 4B："未命中策略 → 可以进入 APPROVED 或按项目统一策略直接完成审批投影"
 * - **红线：Submit ≠ Confirm（APPROVED ≠ CONFIRMED）**——未命中策略也绝不自动 CONFIRMED，必须显式 confirm
 * - 事件：PurchaseOrderSubmitted +（命中时）PurchaseOrderApprovalStarted；失败降级不阻断
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // submit 映射现有动作（submit→:edit，不新造权限体系）
  const denied = requirePermission(user, 'purchase-order:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-order.submit');

  const { id } = await params;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const result = await prisma.$transaction(async (tx) => {
    // ① Lock PO（FOR UPDATE）
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: 'NOT_FOUND' as const };

    const po = await tx.purchaseOrder.findFirst({
      where: { id, deletedAt: null },
      include: {
        supplier: { select: { id: true, isActive: true, status: true } },
        lines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } },
      },
    });
    if (!po) return { error: 'NOT_FOUND' as const };

    // ② 状态门禁：仅 DRAFT
    if (po.status !== 'DRAFT') {
      return { error: 'INVALID_STATE' as const, status: po.status };
    }
    // ③ 至少一条有效 Line + quantity>0
    if (po.lines.length === 0) {
      return { error: 'NO_LINES' as const };
    }
    const invalidQty = po.lines.some((l) => l.quantity.lte(0));
    if (invalidQty) {
      return { error: 'QUANTITY_INVALID' as const };
    }
    // ④ Supplier 有效
    if (!po.supplier || po.supplier.isActive === false) {
      return { error: 'SUPPLIER_NOT_FOUND' as const };
    }
    // ⑤ Direct/Requisition 来源一致性（REQUISITION 必带 requisitionId；DIRECT 必为空）
    if (po.sourceType === 'REQUISITION' && !po.requisitionId) {
      return { error: 'SOURCE_MISMATCH' as const };
    }
    if (po.sourceType === 'DIRECT' && po.requisitionId) {
      return { error: 'SOURCE_MISMATCH' as const };
    }

    // ⑥ 金额一致性：服务端重算与 Header 一致（行金额是事实，Header 是聚合投影）
    const subtotal = po.lines.reduce((s, l) => s.plus(l.lineAmount), new Prisma.Decimal(0));
    const taxAmount = po.lines.reduce((s, l) => s.plus(l.taxAmount), new Prisma.Decimal(0));
    const totalAmount = po.lines.reduce((s, l) => s.plus(l.totalAmount), new Prisma.Decimal(0));
    if (
      !subtotal.equals(po.subtotal) ||
      !taxAmount.equals(po.taxAmount) ||
      !totalAmount.equals(po.totalAmount)
    ) {
      return { error: 'AMOUNT_MISMATCH' as const };
    }

    // ⑦ DRAFT → SUBMITTED（同事务）
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: 'SUBMITTED', updatedById: actorId },
    });

    // ⑧ 条件触发审批（同事务；命中策略 → PENDING + workflowInstanceId；未命中 → skipped）
    const wf = await maybeTriggerPurchaseOrderApproval({
      purchaseOrderId: po.id,
      actorId,
      meta,
      tx,
    });

    // ⑨ 未命中策略 → 直接完成审批投影（status=APPROVED + approvalStatus=APPROVED；绝不 CONFIRMED）
    if (wf.skipped === 'no-policy' || wf.skipped === 'no-rule-matched') {
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          status: 'APPROVED',
          approvalStatus: 'APPROVED',
          approvedAt: new Date(),
          approvedById: actorId,
          updatedById: actorId,
        },
      });
    }

    const finalPo = await tx.purchaseOrder.findFirstOrThrow({ where: { id: po.id } });
    return { po: finalPo, workflow: wf };
  }).catch((e: Error) => {
    if (e.message === 'WORKFLOW_DEFINITION_NOT_FOUND') {
      return { error: 'WORKFLOW_FAILED' as const };
    }
    throw e;
  });

  if ('error' in result) {
    switch (result.error) {
      case 'NOT_FOUND':
        return failNotFound(ERROR_CODES.PURCHASE_ORDER_NOT_FOUND, '采购订单不存在');
      case 'INVALID_STATE':
        return failConflict(
          ERROR_CODES.PURCHASE_ORDER_INVALID_STATE,
          `仅 DRAFT 状态可提交（当前 status=${'status' in result ? result.status : ''}）`,
        );
      case 'NO_LINES':
        return failConflict(ERROR_CODES.PURCHASE_ORDER_NO_LINES, '采购订单至少需要一行明细');
      case 'QUANTITY_INVALID':
        return fail(ERROR_CODES.PURCHASE_ORDER_QUANTITY_INVALID, '采购数量必须大于 0', 400);
      case 'SUPPLIER_NOT_FOUND':
        return fail(ERROR_CODES.PURCHASE_ORDER_SUPPLIER_NOT_FOUND, '供应商无效', 409);
      case 'SOURCE_MISMATCH':
        return failConflict(ERROR_CODES.PURCHASE_ORDER_SOURCE_LINE_INVALID, 'Direct/Requisition 来源不一致');
      case 'AMOUNT_MISMATCH':
        return failConflict(ERROR_CODES.PURCHASE_ORDER_INVALID_STATE, '金额与服务端聚合不一致，请刷新后重试');
      case 'WORKFLOW_FAILED':
        return fail(
          ERROR_CODES.PURCHASE_ORDER_WORKFLOW_FAILED,
          '工作流定义不存在或未发布（PURCHASE_ORDER_APPROVAL）',
          409,
        );
      default:
        return fail(ERROR_CODES.INTERNAL_ERROR, '提交失败：未知错误', 500);
    }
  }

  // ⑩ 事件 + 审计（事务外，事件失败降级不阻断）
  await publishPurchaseOrderEvent({
    eventType: 'PurchaseOrderSubmitted',
    actorId,
    entityId: id,
    payload: {
      purchaseOrderId: id,
      purchaseOrderCode: result.po.code,
      sourceType: result.po.sourceType,
      supplierId: result.po.supplierId,
      requisitionId: result.po.requisitionId,
      currency: result.po.currency,
      totalAmount: result.po.totalAmount.toString(),
      submittedBy: actorId,
      submittedAt: new Date().toISOString(),
    },
    meta,
  }).catch(() => undefined);
  await writeAuditLog({
    actorId,
    action: 'purchase-order.submit',
    entityType: 'purchase-order',
    entityId: id,
    afterData: {
      status: result.po.status,
      approvalStatus: result.po.approvalStatus,
      workflowSkipped: result.workflow.skipped ?? null,
      resubmitted: result.workflow.resubmitted ?? false,
    },
    ...meta,
  });

  return ok({
    id,
    status: result.po.status,
    approvalStatus: result.po.approvalStatus,
    workflowInstanceId: result.po.workflowInstanceId,
    workflowSkipped: result.workflow.skipped ?? null,
    resubmitted: result.workflow.resubmitted ?? false,
  });
}
