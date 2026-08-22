import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, failNotFound, failConflict } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';

export const dynamic = 'force-dynamic';

/** GET /api/supplier-payments/:id（详情含未作废核销行 + 各 Open Item 摘要） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'supplier-payment:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'supplier-payment.get');

  const { id } = await params;
  const payment = await prisma.supplierPayment.findFirst({
    where: { id, deletedAt: null },
    include: {
      supplier: { select: { id: true, code: true, name: true } },
      allocations: {
        where: { deletedAt: null, reversedAt: null },
        orderBy: { allocatedAt: 'desc' },
        include: { apOpenItem: { select: { id: true, openAmount: true, settlementStatus: true } } },
      },
    },
  });
  if (!payment) return failNotFound(ERROR_CODES.NOT_FOUND, '付款单不存在');
  return ok(payment);
}
/** DELETE /api/supplier-payments/:id（层层回退-层层可删除，用户指令 2026-08-21）
 * 可删：UNALLOCATED 且未核销（无 active allocations）；已作废（voidedAt）也可清理。
 * 引用防御：已核销（allocations reversedAt IS NULL）禁止删除——先冲销核销。
 * 软删 header。
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "supplier-payment:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "supplier-payment.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.supplierPayment.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "付款单不存在");
  if (!existing.voidedAt && existing.status !== "UNALLOCATED") {
    return failConflict(ERROR_CODES.NOT_FOUND, "已核销付款单禁止删除（先冲销核销或作废）");
  }
  const activeAllocs = await prisma.supplierPaymentAllocation.count({
    where: { paymentId: id, deletedAt: null, reversedAt: null },
  });
  if (activeAllocs > 0) {
    return failConflict(ERROR_CODES.NOT_FOUND, "付款单仍有未冲销核销记录，禁止删除（先冲销核销）");
  }

  await prisma.supplierPayment.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "supplier-payment.delete",
    entityType: "supplier-payment",
    entityId: id,
    afterData: { code: existing.code },
    ...meta,
  });

  return ok({ id, deleted: true });
}
