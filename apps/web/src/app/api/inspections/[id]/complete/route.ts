import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { inspectionCompleteSchema } from '@/lib/api/schemas';
import {
  computeInspectableQty,
  deriveInspectionResult,
  skipInspectionVerdict,
} from '@/lib/inspection/helpers';
import { publishInspectionEvent } from '@/lib/inspection/events';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inspections/:id/complete —— **CTO Gate（Complete Inspection）**
 * 硬约束（CTO #7045）：
 * - 来源：已 **RECEIVED** 的 PurchaseReceiptLine（最终 Gate 再校验一次）；
 * - 可检数量 `inspectableQty = quantity - rejectedOnReceiptQty`（**最大可检数量不再次包含现场拒收**）；
 * - 数量关系：`qualifiedQty >= 0`、`rejectedQty >= 0`、**`qualifiedQty + rejectedQty === inspectableQty`（=）**
 *   （一次 Inspection 即最终检验结果；未来多轮/抽检需先明确累计语义，本版不猜测）；
 * - 免检：SKIP + QUALIFIED（服务端强制 qualifiedQty=inspectableQty、rejectedQty=0、result=QUALIFIED，
 *   **不允许绕开 Inspection**——SKIP 也要落 Inspection 记录并 complete）；
 * - result 服务端推导（客户端不得传）：QUALIFIED / PARTIAL / REJECTED；
 * - 事件：只有 complete 事务成功提交后才发 `InspectionCompleted`（规则⑧事件纪律）；
 * - 红线：Inspection **禁写 Stock / InventoryMovement / WarehouseReceipt**（6A 唯一事实源；D10：只有 WarehouseReceipt Posted 才触发 6A）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // complete 是质检结论落定动作（普通检验不走审批 P1b → :edit，对齐 receive 先例；超收/特殊退货才走 Workflow + :approve）
  const denied = requirePermission(user, 'inspection:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'inspection.complete');

  const { id } = await params;
  const parsed = inspectionCompleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version, qualifiedQty, rejectedQty } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const result = await prisma.$transaction(async (tx) => {
    // ① Lock Inspection（FOR UPDATE）
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "Inspection" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: 'NOT_FOUND' as const };

    const inspection = await tx.inspection.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        purchaseReceiptLineId: true,
        inspectionMode: true,
        result: true,
        version: true,
        purchaseReceiptLine: {
          select: {
            id: true,
            quantity: true,
            rejectedOnReceiptQty: true,
            purchaseReceipt: { select: { id: true, status: true } },
          },
        },
      },
    });
    if (!inspection) return { error: 'NOT_FOUND' as const };

    // ② 状态 Gate：仅 PENDING 可 complete
    if (inspection.result !== 'PENDING') {
      return { error: 'INVALID_STATE' as const, status: inspection.result };
    }
    // ③ 来源 Gate（最终 Gate 再校验）：必须是已 RECEIVED 的收货行
    if (inspection.purchaseReceiptLine.purchaseReceipt.status !== 'RECEIVED') {
      return { error: 'LINE_NOT_RECEIVED' as const };
    }

    // ④ 可检数量（CTO #7045：quantity 已含现场拒收，可检数不得再次包含 rejectedOnReceiptQty）
    const inspectableQty = computeInspectableQty(
      inspection.purchaseReceiptLine.quantity,
      inspection.purchaseReceiptLine.rejectedOnReceiptQty,
    );

    // ⑤ 结论定稿：SKIP 免检（服务端强制，不绕开）；SPOT/FULL 校验数量关系（=）
    let verdict: {
      result: 'QUALIFIED' | 'PARTIAL' | 'REJECTED';
      qualifiedQty: Prisma.Decimal;
      rejectedQty: Prisma.Decimal;
    };
    if (inspection.inspectionMode === 'SKIP') {
      verdict = skipInspectionVerdict(inspectableQty);
    } else {
      if (qualifiedQty === undefined || rejectedQty === undefined) {
        return { error: 'QUANTITY_INVALID' as const };
      }
      const q = new Prisma.Decimal(qualifiedQty);
      const r = new Prisma.Decimal(rejectedQty);
      if (q.isNegative() || r.isNegative() || !q.plus(r).equals(inspectableQty)) {
        return { error: 'QUANTITY_INVALID' as const };
      }
      verdict = {
        result: deriveInspectionResult(q, inspectableQty),
        qualifiedQty: q,
        rejectedQty: r,
      };
    }

    // ⑥ CAS 落定（id + version + result=PENDING 原子条件；成功递增 version）
    const inspectedAt = new Date();
    const cas = await tx.inspection.updateMany({
      where: { id, version, result: 'PENDING', deletedAt: null },
      data: {
        result: verdict.result,
        qualifiedQty: verdict.qualifiedQty,
        rejectedQty: verdict.rejectedQty,
        inspectedById: actorId,
        inspectedAt,
        updatedById: actorId,
        version: { increment: 1 },
      },
    });
    if (cas.count !== 1) {
      return { error: 'VERSION_CONFLICT' as const };
    }

    return {
      ok: true as const,
      inspectionId: inspection.id,
      purchaseReceiptLineId: inspection.purchaseReceiptLineId,
      inspectionMode: inspection.inspectionMode,
      result: verdict.result,
      qualifiedQty: verdict.qualifiedQty.toString(),
      rejectedQty: verdict.rejectedQty.toString(),
      inspectedAt: inspectedAt.toISOString(),
    };
  });

  if ('error' in result) {
    switch (result.error) {
      case 'NOT_FOUND':
        return failNotFound(ERROR_CODES.INSPECTION_NOT_FOUND, '质检记录不存在');
      case 'INVALID_STATE':
        return failConflict(
          ERROR_CODES.INSPECTION_INVALID_STATE,
          `仅 PENDING 状态可完成检验（当前 ${result.status}）`,
        );
      case 'LINE_NOT_RECEIVED':
        return failConflict(
          ERROR_CODES.INSPECTION_LINE_NOT_RECEIVED,
          '来源收货行必须已 RECEIVED 才能完成检验',
        );
      case 'QUANTITY_INVALID':
        return fail(
          ERROR_CODES.INSPECTION_QUANTITY_INVALID,
          '检验数量不合法（qualifiedQty>=0、rejectedQty>=0 且 qualifiedQty + rejectedQty === inspectableQty = quantity - rejectedOnReceiptQty）',
          400,
        );
      case 'VERSION_CONFLICT':
        return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试（并发修改）');
      default:
        return failConflict(ERROR_CODES.CONFLICT, '完成检验失败');
    }
  }

  // ⑦ 事务成功提交后发布事件（规则⑧：只有 complete 成功后发 InspectionCompleted；载荷对齐 EVENTS.md 2.3.9）
  try {
    await publishInspectionEvent({
      eventType: 'InspectionCompleted',
      actorId,
      entityId: result.inspectionId,
      payload: {
        inspectionId: result.inspectionId,
        purchaseReceiptLineId: result.purchaseReceiptLineId,
        inspectionMode: result.inspectionMode,
        result: result.result,
        qualifiedQty: result.qualifiedQty,
        rejectedQty: result.rejectedQty,
        inspectedById: actorId,
        inspectedAt: result.inspectedAt,
      },
      meta,
    });
  } catch {
    // 事件总线未落地（Known Risk）：发布失败不阻断业务事实（事务已提交）；生产前升级 Transactional Outbox（CTO #7045 债务记录）
  }

  // **Minor（CTO #7115）**：Audit 与 Domain Event 是两个不同用途——有 Event 不能省 Audit。
  // 最终质检动作显式留审计（action=InspectionCompleted / entityType=inspection，完整事实字段）。
  await writeAuditLog({
    actorId,
    action: 'InspectionCompleted',
    entityType: 'inspection',
    entityId: result.inspectionId,
    afterData: {
      inspectionId: result.inspectionId,
      purchaseReceiptLineId: result.purchaseReceiptLineId,
      inspectionMode: result.inspectionMode,
      result: result.result,
      qualifiedQty: result.qualifiedQty,
      rejectedQty: result.rejectedQty,
      inspectedById: actorId,
      inspectedAt: result.inspectedAt,
    },
    meta,
  });

  return ok({
    id: result.inspectionId,
    purchaseReceiptLineId: result.purchaseReceiptLineId,
    inspectionMode: result.inspectionMode,
    result: result.result,
    qualifiedQty: result.qualifiedQty,
    rejectedQty: result.rejectedQty,
    inspectedAt: result.inspectedAt,
  });
}
