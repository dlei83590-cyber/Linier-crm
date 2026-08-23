import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, failValidation, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { inspectionUpdateSchema } from '@/lib/api/schemas';

export const dynamic = 'force-dynamic';

/** GET /api/inspections/:id（详情：Inspection + 收货行（含 Item/UOM/收货单） + 检验人） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'inspection:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'inspection.get');

  const { id } = await params;
  const inspection = await prisma.inspection.findFirst({
    where: { id, deletedAt: null },
    include: {
      purchaseReceiptLine: {
        select: {
          id: true,
          lineNo: true,
          quantity: true,
          rejectedOnReceiptQty: true,
          visibleDamageQty: true,
          purchaseReceipt: {
            select: { id: true, code: true, status: true, receivedAt: true },
          },
          purchaseOrderLine: {
            select: { id: true, lineNo: true, quantity: true, fulfillmentType: true },
          },
          item: { select: { id: true, code: true, name: true, model: true } },
          uom: { select: { id: true, code: true, symbol: true } },
        },
      },
      inspectedBy: { select: { id: true, name: true, email: true } },
    },
  });
  if (!inspection) return failNotFound(ERROR_CODES.INSPECTION_NOT_FOUND, '质检记录不存在');

  // 核销闭环（用户指令 2026-08-21）：已 POSTED 入库占用 + 已 RETURNED 退货占用
  const [usedRow, returnedRow] = await Promise.all([
    prisma.warehouseReceiptLine.aggregate({
      where: {
        inspectionId: id,
        warehouseReceipt: { status: 'POSTED', deletedAt: null },
        deletedAt: null,
      },
      _sum: { quantity: true },
    }),
    prisma.purchaseReturnLine.aggregate({
      where: {
        sourceRefType: 'INSPECTION',
        sourceInspectionId: id,
        purchaseReturn: { status: 'RETURNED', deletedAt: null },
        deletedAt: null,
      },
      _sum: { quantity: true },
    }),
  ]);
  const usedQty = usedRow._sum.quantity ?? new Prisma.Decimal(0);
  const returnedQty = returnedRow._sum.quantity ?? new Prisma.Decimal(0);

  return ok({
    ...inspection,
    usedQty: usedQty.toString(),
    returnedQty: returnedQty.toString(),
    availableQty: Prisma.Decimal.max(
      new Prisma.Decimal(inspection.qualifiedQty.toString()).minus(usedQty),
      new Prisma.Decimal(0),
    ).toString(),
    returnableQty: Prisma.Decimal.max(
      new Prisma.Decimal(inspection.rejectedQty.toString()).minus(returnedQty),
      new Prisma.Decimal(0),
    ).toString(),
  });
}

/**
 * PATCH /api/inspections/:id（**仅 PENDING 阶段**；CAS 乐观锁 + version 递增；只允许改 inspectionMode/remark——数量在 complete 定稿）
 * CTO #7045：一次 Inspection 即最终检验结果；数量关系（= inspectableQty）由 complete Gate 校验，本层不接收数量。
 * 红线：Inspection **禁写 Stock / InventoryMovement / WarehouseReceipt**（6A 唯一事实源）。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'inspection:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'inspection.update');

  const { id } = await params;
  const parsed = inspectionUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version, ...fields } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const existing = await prisma.inspection.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, result: true, version: true },
  });
  if (!existing) return failNotFound(ERROR_CODES.INSPECTION_NOT_FOUND, '质检记录不存在');
  if (existing.result !== 'PENDING') {
    return failConflict(
      ERROR_CODES.INSPECTION_INVALID_STATE,
      `仅 PENDING 状态可编辑（当前 ${existing.result}）`,
    );
  }
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试');
  }

  const updated = await prisma
    .$transaction(async (tx) => {
      // 原子 CAS 乐观锁（Phase 3 教训沿用）：仅当 id + version + result=PENDING 同时命中才更新（CAS 成功递增 version）
      const cas = await tx.inspection.updateMany({
        where: { id, version, result: 'PENDING', deletedAt: null },
        data: {
          ...(fields.inspectionMode !== undefined ? { inspectionMode: fields.inspectionMode } : {}),
          ...(fields.remark !== undefined ? { remark: fields.remark } : {}),
          updatedById: actorId,
          version: { increment: 1 },
        },
      });
      if (cas.count !== 1) {
        throw new Error('VERSION_CONFLICT');
      }
      return tx.inspection.findFirstOrThrow({
        where: { id, deletedAt: null },
        select: {
          id: true,
          purchaseReceiptLineId: true,
          inspectionMode: true,
          result: true,
          remark: true,
          version: true,
          updatedAt: true,
        },
      });
    })
    .catch((e) => {
      if (e instanceof Error && e.message === 'VERSION_CONFLICT')
        return { error: 'VERSION_CONFLICT' as const };
      throw e;
    });

  if ('error' in updated) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试（并发修改）');
  }

  // PENDING 变更不发领域事件（对齐规则⑧事件纪律）——仅 AuditLog 留痕
  await writeAuditLog({
    actorId,
    action: 'InspectionUpdated',
    entityType: 'inspection',
    entityId: id,
    afterData: {
      inspectionId: id,
      inspectionMode: updated.inspectionMode,
      remark: updated.remark,
      version: updated.version,
      updatedById: actorId,
    },
    meta,
  });

  return ok(updated);
}
