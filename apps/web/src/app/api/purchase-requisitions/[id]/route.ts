import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { recycleDocumentSequence } from '@/lib/document-sequence/recycle';
import { purchaseRequisitionUpdateSchema } from '@/lib/api/schemas';
import {
  createPurchaseRequisitionRevision,
  validatePurchaseRequisitionQuantity,
} from '@/lib/purchase-requisition/helpers';
import { publishPurchaseRequisitionEvent } from '@/lib/purchase-requisition/events';

export const dynamic = 'force-dynamic';

const EDITABLE_STATUSES = ['DRAFT'] as const;

/** GET /api/purchase-requisitions/:id（详情：Header + Requester/Department + Workflow + Lines(Item/UOM) + Latest Revision） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'purchase-requisition:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-requisition.get');

  const { id } = await params;
  const pr = await prisma.purchaseRequisition.findFirst({
    where: { id, deletedAt: null },
    include: {
      requester: { select: { id: true, email: true, name: true } },
      department: { select: { id: true, code: true, name: true } },
      workflowInstance: {
        select: { id: true, status: true, currentStepNo: true, startedAt: true, completedAt: true },
      },
      lines: {
        where: { deletedAt: null },
        orderBy: { lineNo: 'asc' },
        include: {
          item: { select: { id: true, code: true, name: true, model: true } },
          uom: { select: { id: true, code: true, name: true, symbol: true } },
        },
      },
      revisions: { where: { deletedAt: null }, orderBy: { revisionNo: 'desc' }, take: 1 },
    },
  });
  if (!pr) return failNotFound(ERROR_CODES.PURCHASE_REQUISITION_NOT_FOUND, '采购申请不存在');

  return ok(pr);
}

/**
 * PATCH /api/purchase-requisitions/:id（更新头 + 可选行全量替换；仅 DRAFT；乐观锁 version）
 * CTO Phase 3 红线：只允许 DRAFT 修改；修改必须产生 Revision（变更前快照）；
 * 禁止修改 code/status/requesterId/departmentId/金额字段（PR 无金额事实）；
 * Line 不作为独立业务入口 → 行变更经 PATCH 整体替换（服务端验证 Item/UOM + quantity>0）；
 * 不触发重新审批（PR 无金额，无财务字段可触发重审）、不创建 PO。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'purchase-requisition:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-requisition.update');

  const { id } = await params;
  const parsed = purchaseRequisitionUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version, changeReason, lines, ...fields } = parsed.data;
  const meta = requestMeta(request);

  const existing = await prisma.purchaseRequisition.findFirst({
    where: { id, deletedAt: null },
    include: { lines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } } },
  });
  if (!existing) return failNotFound(ERROR_CODES.PURCHASE_REQUISITION_NOT_FOUND, '采购申请不存在');
  if ((EDITABLE_STATUSES as readonly string[]).includes(existing.status) === false) {
    return failConflict(
      ERROR_CODES.PURCHASE_REQUISITION_INVALID_STATE,
      `仅 DRAFT 状态可编辑（当前 ${existing.status}）`,
    );
  }
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试');
  }

  // 行替换时服务端验证 Item/UOM 引用（红线：引用在服务端验证）
  if (lines) {
    const itemIds = [...new Set(lines.map((l) => l.itemId))];
    const uomIds = [...new Set(lines.filter((l) => l.uomId).map((l) => l.uomId!))];
    const [items, uoms] = await Promise.all([
      prisma.item.findMany({
        where: { id: { in: itemIds }, deletedAt: null },
        select: { id: true },
      }),
      uomIds.length > 0
        ? prisma.unitOfMeasure.findMany({
            where: { id: { in: uomIds }, deletedAt: null },
            select: { id: true },
          })
        : Promise.resolve([]),
    ]);
    if (items.length !== itemIds.length) {
      return fail(ERROR_CODES.PURCHASE_REQUISITION_ITEM_NOT_FOUND, '存在无效的 Item 引用', 400);
    }
    if (uoms.length !== uomIds.length) {
      return fail(ERROR_CODES.PURCHASE_REQUISITION_UOM_NOT_FOUND, '存在无效的 UOM 引用', 400);
    }
  }

  let updated: Awaited<ReturnType<typeof prisma.purchaseRequisition.findFirstOrThrow>>;
  try {
    // 单事务：Revision（变更前快照）+ 原子 CAS 头更新 + 行全量替换
    // **CTO Phase 3 Review Blocking ①**：乐观锁必须数据库级原子（预检查不足以防并发 lost update）——
    // 真正更新时把 version + status 放进原子条件（updateMany where {id, version, status:"DRAFT"}，count===1）；
    // 失败统一 409 VERSION_CONFLICT。Revision + Header + Lines 替换仍保持同一事务。
    updated = await prisma.$transaction(async (tx) => {
      // 变更前快照 → Revision（修改必须产生 Revision；红线）
      const snapshot = {
        header: {
          code: existing.code,
          requesterId: existing.requesterId,
          departmentId: existing.departmentId,
          status: existing.status,
          needDate: existing.needDate,
          remark: existing.remark,
          approvalStatus: existing.approvalStatus,
        },
        lines: existing.lines.map((l) => ({
          lineNo: l.lineNo,
          itemId: l.itemId,
          description: l.description,
          quantity: l.quantity.toString(),
          uomId: l.uomId,
          needDate: l.needDate,
          remark: l.remark,
        })),
      };
      await createPurchaseRequisitionRevision(
        tx,
        id,
        changeReason ?? '更新采购申请',
        snapshot,
        user?.id,
      );

      // 原子 CAS 头更新（仅非金额字段：needDate/remark；version + DRAFT 条件，count===1 才成功）
      const cas = await tx.purchaseRequisition.updateMany({
        where: { id, version, status: 'DRAFT' },
        data: {
          ...(fields.needDate !== undefined
            ? { needDate: fields.needDate ? new Date(fields.needDate) : null }
            : {}),
          ...(fields.remark !== undefined ? { remark: fields.remark } : {}),
          version: { increment: 1 },
          updatedById: user!.id,
        },
      });
      if (cas.count !== 1) throw new Error('PR_VERSION_CONFLICT');
      // updateMany 不返回记录 → 同事务重读更新后的 Header
      const saved = await tx.purchaseRequisition.findFirstOrThrow({ where: { id } });

      // 行全量替换（Line 不作为独立业务入口 → 软删旧行 + 重建；服务端验证 Item/UOM + quantity>0）
      if (lines) {
        await tx.purchaseRequisitionLine.updateMany({
          where: { purchaseRequisitionId: id, deletedAt: null },
          data: { deletedAt: new Date(), updatedById: user!.id },
        });
        for (const [idx, line] of lines.entries()) {
          const quantity = new Prisma.Decimal(line.quantity);
          const q = validatePurchaseRequisitionQuantity(quantity);
          if (!q.ok) throw new Error(q.reason);
          await tx.purchaseRequisitionLine.create({
            data: {
              purchaseRequisitionId: id,
              lineNo: line.lineNo ?? (idx + 1) * 10,
              itemId: line.itemId,
              description: line.description ?? '',
              quantity,
              uomId: line.uomId ?? null,
              needDate: line.needDate ? new Date(line.needDate) : null,
              remark: line.remark ?? null,
              createdById: user!.id,
              updatedById: user!.id,
            },
          });
        }
      }
      return saved;
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'PR_VERSION_CONFLICT') {
      return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试（并发修改）');
    }
    if (e instanceof Error && e.message === 'PR_QUANTITY_INVALID') {
      return fail(ERROR_CODES.PURCHASE_REQUISITION_QUANTITY_INVALID, '需求数量必须大于 0', 400);
    }
    throw e;
  }

  await publishPurchaseRequisitionEvent({
    eventType: 'PurchaseRequisitionUpdated',
    actorId: user?.id,
    entityId: id,
    payload: {
      requisitionId: id,
      requisitionCode: updated.code,
      requesterId: updated.requesterId,
      departmentId: updated.departmentId,
      changeReason: changeReason ?? '更新采购申请',
    },
    meta,
  }).catch(() => undefined);
  await writeAuditLog({
    actorId: user?.id,
    action: 'purchase-requisition.update',
    entityType: 'purchase-requisition',
    entityId: id,
    afterData: { fields: Object.keys(fields), linesReplaced: !!lines, version: updated.version },
    ...meta,
  });

  return ok(updated);
}
/** DELETE /api/purchase-requisitions/:id（层层回退-层层可删除，用户指令 2026-08-21）
 * 可删状态：DRAFT/SUBMITTED/CANCELLED（未生效/已取消）；APPROVED/CONVERTED 禁止（已生效/已转 PO）。
 * 引用防御：已生成 PO（purchaseOrders）禁止删除——保持 PO 溯源链。
 * 软删 header + lines + revisions（deletedAt 置位，列表不再展示）。
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "purchase-requisition:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "purchase-requisition.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.purchaseRequisition.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.PURCHASE_REQUISITION_NOT_FOUND, "采购申请不存在");
  // 全链条回退（用户指令 2026-08-21）：APPROVED 且无 PO 引用（已回退）也可删除
  if (!["DRAFT", "SUBMITTED", "CANCELLED", "APPROVED"].includes(existing.status)) {
    return failConflict(ERROR_CODES.PURCHASE_REQUISITION_INVALID_STATE, "仅 DRAFT/SUBMITTED/CANCELLED/APPROVED（无PO）状态可删除");
  }
  const poCount = await prisma.purchaseOrder.count({ where: { requisitionId: id, deletedAt: null } });
  if (poCount > 0) {
    return failConflict(ERROR_CODES.PURCHASE_REQUISITION_INVALID_STATE, "采购申请已生成采购订单，禁止删除（保持 PO 溯源）");
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.purchaseRequisition.update({ where: { id }, data: { deletedAt: now, isActive: false, updatedById: user!.id } });
    await tx.purchaseRequisitionLine.updateMany({ where: { purchaseRequisitionId: id, deletedAt: null }, data: { deletedAt: now, isActive: false } });
    await tx.purchaseRequisitionRevision.updateMany({ where: { purchaseRequisitionId: id, deletedAt: null }, data: { deletedAt: now, isActive: false } });
    // 单号回收（用户指令 2026-08-21 全程回收单号）
    await recycleDocumentSequence(tx, "PURCHASE_REQUISITION", existing.code);
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "purchase-requisition.delete",
    entityType: "purchase-requisition",
    entityId: id,
    afterData: { code: existing.code },
    ...meta,
  });

  return ok({ id, deleted: true });
}

