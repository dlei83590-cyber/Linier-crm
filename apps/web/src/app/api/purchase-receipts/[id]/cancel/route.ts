import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/purchase-receipts/:id/cancel —— Cancel（**仅 DRAFT → CANCELLED**）
 * CTO #6944 边界锁死：
 * - **只允许 DRAFT 取消**；`RECEIVED` 收货事实**不得通过 cancel 撤销/反冲**（后续应独立设计 reversal / PurchaseReturn）；
 * - 不做：回滚 PO Line receivedQty / remainingReceiveQty、恢复 PO 状态、删除 Receipt/Lines、发布"反冲库存"类事件；
 * - 带：RBAC（purchase-receipt:close）+ 状态门禁 + **CAS/version 乐观锁** + 审计字段更新（updatedById）；
 * - 事件纪律：EVENTS.md 2.3.9 未注册 PurchaseReceiptCancelled 领域事件 → 仅 AuditLog 留痕，不发布事件。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // cancel 映射现有动作（对齐 PO cancel 先例：cancel→:close）
  const denied = requirePermission(user, 'purchase-receipt:close');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-receipt.cancel');

  const { id } = await params;
  const meta = requestMeta(request);
  const actorId = user!.id;

  // CAS/version 乐观锁（对齐 PATCH 模式：客户端必须提交当前 version）
  const body = (await request.json().catch(() => null)) as { version?: number } | null;
  if (!body || typeof body.version !== 'number' || body.version <= 0) {
    return fail(ERROR_CODES.VERSION_CONFLICT, '必须提供 version（乐观锁）', 400);
  }
  const { version } = body;

  const result = await prisma.$transaction(async (tx) => {
    // ① Lock PurchaseReceipt（FOR UPDATE）
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "PurchaseReceipt" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: 'NOT_FOUND' as const };

    const receipt = await tx.purchaseReceipt.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, code: true, status: true, version: true, purchaseOrderId: true },
    });
    if (!receipt) return { error: 'NOT_FOUND' as const };

    // ② 状态门禁：仅 DRAFT 可取消；RECEIVED 收货事实不得经 cancel 撤销（CTO #6944）
    if (receipt.status === 'RECEIVED') {
      return { error: 'CANCEL_FORBIDDEN' as const, status: receipt.status };
    }
    if (receipt.status !== 'DRAFT') {
      return { error: 'INVALID_STATE' as const, status: receipt.status };
    }

    // ③ CAS/version 乐观锁：id + version + status=DRAFT 同时命中才更新（原子条件）
    const cas = await tx.purchaseReceipt.updateMany({
      where: { id, version, status: 'DRAFT', deletedAt: null },
      data: {
        status: 'CANCELLED',
        updatedById: actorId,
      },
    });
    if (cas.count !== 1) {
      return { error: 'VERSION_CONFLICT' as const };
    }

    return { ok: true as const, id: receipt.id, code: receipt.code };
  });

  if ('error' in result) {
    switch (result.error) {
      case 'NOT_FOUND':
        return failNotFound(ERROR_CODES.PURCHASE_RECEIPT_NOT_FOUND, '收货单不存在');
      case 'CANCEL_FORBIDDEN':
        return failConflict(
          ERROR_CODES.PURCHASE_RECEIPT_CANCEL_FORBIDDEN,
          '已收货（RECEIVED）的收货单不得取消；如需撤销请走独立 reversal / PurchaseReturn 流程',
        );
      case 'INVALID_STATE':
        return failConflict(
          ERROR_CODES.PURCHASE_RECEIPT_INVALID_STATE,
          `仅 DRAFT 状态可取消（当前 ${result.status}）`,
        );
      case 'VERSION_CONFLICT':
        return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试（并发修改）');
      default:
        return failConflict(ERROR_CODES.CONFLICT, '取消失败');
    }
  }

  // 事件纪律：EVENTS.md 2.3.9 未注册 PurchaseReceiptCancelled 领域事件 → 仅 AuditLog 留痕
  await writeAuditLog({
    actorId,
    action: 'PurchaseReceiptCancelled',
    entityType: 'purchase-receipt',
    entityId: result.id,
    afterData: {
      purchaseReceiptId: result.id,
      purchaseReceiptCode: result.code,
      cancelledById: actorId,
      cancelledAt: new Date().toISOString(),
    },
    meta,
  });

  return ok({ id: result.id, code: result.code, status: 'CANCELLED' });
}
