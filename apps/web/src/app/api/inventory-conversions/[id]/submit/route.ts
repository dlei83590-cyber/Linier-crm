import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { inventoryConversionSubmitSchema } from '@/lib/api/schemas';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inventory-conversions/:id/submit —— DRAFT → SUBMITTED（CTO 6B-4 Conversion Vertical Slice）
 * - 校验：仅 DRAFT；恰好 1 CONSUME + 1 PRODUCE；quantity>0；uomToBaseRate>0；warehouse/location/item/uom 有效；
 *   batch 精确继承；**baseQuantity 守恒前置校验**（CONSUME.baseQuantity == PRODUCE.baseQuantity——由服务端 canonical 计算值比较）
 * - **Conversion 无审批状态机（DRAFT/SUBMITTED/EXECUTED/CANCELLED）**——同 item Repack/UOM 计量事实，
 *   不发明审批流；submit 只是提交确认（DRAFT → SUBMITTED）
 * - **红线：SUBMITTED ≠ EXECUTED**——submit 绝不自动落账，只有显式 POST /:id/execute 才经 Shared
 *   LedgerCommand 双 atom（CONSUME + PRODUCE 同一 movementGroupId）同事务落账
 * - 事件：本阶段 Conversion 业务层事件仅 InventoryConversionExecuted（EVENTS v1.28）；submit 仅 AuditLog
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // submit 映射现有动作（submit→:edit，不新造权限体系——对齐 5A/5B/6B-2/6B-3 拍板）
  const denied = requirePermission(user, 'inventory-conversion:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'inventory-conversion.submit');

  const { id } = await params;
  const parsed = inventoryConversionSubmitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const result = await prisma.$transaction(async (tx) => {
    // ① Lock Conversion（FOR UPDATE）
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "InventoryConversion" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: 'NOT_FOUND' as const };

    const conversion = await tx.inventoryConversion.findFirst({
      where: { id, deletedAt: null },
      include: {
        lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!conversion) return { error: 'NOT_FOUND' as const };

    // ② 状态门禁：仅 DRAFT
    if (conversion.status !== 'DRAFT') {
      return { error: 'INVALID_STATE' as const, status: conversion.status };
    }
    // ③ CAS version
    if (conversion.version !== version) {
      return { error: 'VERSION_CONFLICT' as const };
    }
    // ④ 恰好 1 CONSUME + 1 PRODUCE（DB UNIQUE(conversionHeaderId, lineRole) 兜底）
    if (conversion.lines.length !== 2) {
      return { error: 'NO_LINES' as const };
    }
    const roles = conversion.lines.map((l) => l.lineRole);
    if (!roles.includes('CONSUME') || !roles.includes('PRODUCE')) {
      return { error: 'LINE_ROLE_REQUIRED' as const };
    }
    // ⑤ 数量/换算率校验（DB CHECK 兜底，此处防御性复核）
    if (conversion.lines.some((l) => l.quantity.lte(0) || l.uomToBaseRate.lte(0) || l.baseQuantity.lte(0))) {
      return { error: 'QUANTITY_INVALID' as const };
    }
    // ⑥ 守恒前置校验（P11 Final）：CONSUME.baseQuantity == PRODUCE.baseQuantity
    const consume = conversion.lines.find((l) => l.lineRole === 'CONSUME')!;
    const produce = conversion.lines.find((l) => l.lineRole === 'PRODUCE')!;
    if (!consume.baseQuantity.equals(produce.baseQuantity)) {
      return { error: 'BASE_QTY_MISMATCH' as const };
    }
    // ⑦ batch 精确继承（P5 Final：CONSUME batch → PRODUCE batch 同值）
    if ((consume.batchNo ?? null) !== (produce.batchNo ?? null)) {
      return { error: 'BATCH_MISMATCH' as const };
    }

    // ⑧ DRAFT → SUBMITTED（CAS：id + version + status=DRAFT 同时命中）
    const submitted = await tx.inventoryConversion.updateMany({
      where: { id, version, status: 'DRAFT', deletedAt: null },
      data: { status: 'SUBMITTED', updatedById: actorId, version: { increment: 1 } },
    });
    if (submitted.count !== 1) {
      return { error: 'VERSION_CONFLICT' as const };
    }

    const finalConversion = await tx.inventoryConversion.findFirstOrThrow({
      where: { id: conversion.id, deletedAt: null },
      include: {
        item: { select: { id: true, code: true, name: true, model: true } },
        baseUom: { select: { id: true, code: true, symbol: true } },
        lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      },
    });
    return { conversion: finalConversion };
  }).catch((e: Error) => {
    throw e;
  });

  if ('error' in result) {
    switch (result.error) {
      case 'NOT_FOUND':
        return failNotFound(ERROR_CODES.INVENTORY_CONVERSION_NOT_FOUND, '转换单不存在');
      case 'INVALID_STATE':
        return failConflict(
          ERROR_CODES.INVENTORY_CONVERSION_INVALID_STATE,
          `仅 DRAFT 状态可提交（当前 ${(result as { status?: string }).status ?? '未知'}）`,
        );
      case 'VERSION_CONFLICT':
        return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试');
      case 'NO_LINES':
        return fail(ERROR_CODES.INVENTORY_CONVERSION_NO_LINES, '转换单必须恰好包含 1 CONSUME + 1 PRODUCE', 400);
      case 'LINE_ROLE_REQUIRED':
        return fail(ERROR_CODES.INVENTORY_CONVERSION_LINE_ROLE_REQUIRED, '必须恰好 1 条 CONSUME + 1 条 PRODUCE（单输入单输出）', 400);
      case 'QUANTITY_INVALID':
        return fail(ERROR_CODES.INVENTORY_CONVERSION_INVALID_STATE, '转换数量/换算率/canonical 数量必须 > 0', 400);
      case 'BASE_QTY_MISMATCH':
        return fail(ERROR_CODES.INVENTORY_CONVERSION_BASE_QTY_MISMATCH, 'CONSUME.baseQuantity 必须 == PRODUCE.baseQuantity（守恒，P11）', 400);
      case 'BATCH_MISMATCH':
        return fail(ERROR_CODES.INVENTORY_CONVERSION_BATCH_MISMATCH, 'CONSUME 与 PRODUCE 的 batchNo 必须一致（P5 精确继承，首版不拆批不换批）', 400);
      default:
        return fail(ERROR_CODES.INTERNAL_ERROR, '提交转换单失败', 500);
    }
  }

  await writeAuditLog({
    actorId,
    action: 'inventory-conversion:submit',
    entityType: 'inventory-conversion',
    entityId: result.conversion.id,
    afterData: { conversionNo: result.conversion.conversionNo, status: result.conversion.status },
    meta,
  });

  return ok({ conversion: result.conversion });
}
