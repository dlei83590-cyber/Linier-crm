import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, failValidation, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { inventoryTransferCancelSchema } from '@/lib/api/schemas';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inventory-transfers/:id/cancel —— Cancel（CTO 6B-2 Transfer Vertical Slice Cancel 规则）
 * - **DRAFT / APPROVED**：允许 Cancel（DRAFT → CANCELLED；APPROVED → CANCELLED——未执行，可安全取消）
 * - **SUBMITTED**：不允许直接 Cancel（409）——审批进行中，先 Withdraw Workflow（→ DRAFT）再 Cancel；
 *   或走驳回重提流程；不开放 SUBMITTED 直取消（避免绕过审批事实）
 * - **EXECUTED**：禁止 Cancel（409）——已执行已落账；纠错未来走**整组 Reversal**，不允许 Cancel 回滚库存
 * - 事务：Lock Transfer → 状态门禁 → CAS（id + version + 目标状态）→ status=CANCELLED →
 *   AuditLog；**不发领域事件**（Cancel 是业务状态事实，非 Ledger 事实；InventoryTransferCancelled 未注册）
 * - **红线：Cancel 绝不触碰 Movement / Projection**（已 EXECUTED 由 Reversal 纠错，不是 Cancel）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // cancel 映射现有动作（对齐 quotation.cancel / purchase-order.cancel 先例：cancel→:close）
  const denied = requirePermission(user, 'inventory-transfer:close');
  if (denied) return denied;
  requestLog(request, user?.id, 'inventory-transfer.cancel');

  const { id } = await params;
  const parsed = inventoryTransferCancelSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const result = await prisma.$transaction(async (tx) => {
    // ① Lock Transfer（FOR UPDATE）
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "InventoryTransfer" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: 'NOT_FOUND' as const };

    const transfer = await tx.inventoryTransfer.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true, version: true },
    });
    if (!transfer) return { error: 'NOT_FOUND' as const };

    // ② 状态门禁（CTO 6B-2 Cancel 规则）
    switch (transfer.status) {
      case 'DRAFT':
      case 'APPROVED':
        break; // 允许 Cancel
      case 'SUBMITTED':
        // 审批进行中：先 Withdraw Workflow 再 Cancel，或走驳回重提；不开放直取消（避免绕过审批事实）
        return { error: 'SUBMITTED_FORBIDDEN' as const };
      case 'EXECUTED':
        // 已执行已落账：禁止 Cancel 回滚库存；纠错未来走整组 Reversal
        return { error: 'EXECUTED_FORBIDDEN' as const };
      case 'CANCELLED':
        return { error: 'ALREADY_CANCELLED' as const };
      default:
        return { error: 'INVALID_STATE' as const };
    }

    // ③ CAS：id + version + status=DRAFT|APPROVED 同时命中才更新（防并发双 Cancel / 并发 Execute）
    const cancelled = await tx.inventoryTransfer.updateMany({
      where: { id, version, status: { in: ['DRAFT', 'APPROVED'] }, deletedAt: null },
      data: { status: 'CANCELLED', updatedById: actorId, version: { increment: 1 } },
    });
    if (cancelled.count !== 1) {
      return { error: 'VERSION_CONFLICT' as const };
    }

    const finalTransfer = await tx.inventoryTransfer.findFirstOrThrow({
      where: { id, deletedAt: null },
      include: {
        sourceWarehouse: { select: { id: true, code: true, name: true } },
        destinationWarehouse: { select: { id: true, code: true, name: true } },
      },
    });
    return { transfer: finalTransfer };
  });

  if ('error' in result) {
    switch (result.error) {
      case 'NOT_FOUND':
        return failNotFound(ERROR_CODES.INVENTORY_TRANSFER_NOT_FOUND, '调拨单不存在');
      case 'SUBMITTED_FORBIDDEN':
        return failConflict(
          ERROR_CODES.INVENTORY_TRANSFER_INVALID_STATE,
          'SUBMITTED 状态不可直接取消：请先 Withdraw 审批（→ DRAFT）再 Cancel，或走驳回重提',
        );
      case 'EXECUTED_FORBIDDEN':
        return failConflict(
          ERROR_CODES.INVENTORY_TRANSFER_INVALID_STATE,
          'EXECUTED 状态禁止 Cancel：已执行已落账，纠错走整组 Reversal，不允许 Cancel 回滚库存',
        );
      case 'ALREADY_CANCELLED':
        return failConflict(ERROR_CODES.INVENTORY_TRANSFER_INVALID_STATE, '调拨单已取消');
      case 'VERSION_CONFLICT':
        return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突或状态已变化，请刷新后重试');
      default:
        return failConflict(ERROR_CODES.INVENTORY_TRANSFER_INVALID_STATE, '当前状态不允许取消');
    }
  }

  await writeAuditLog({
    actorId,
    action: 'inventory-transfer:cancel',
    entityType: 'inventory-transfer',
    entityId: result.transfer.id,
    afterData: { transferNo: result.transfer.transferNo, status: result.transfer.status },
    meta,
  });

  return ok({ transfer: result.transfer });
}
