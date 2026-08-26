import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, parsePagination } from '@/lib/api/response';
import { ERROR_CODES, type ErrorCode } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { inventoryConversionCreateSchema } from '@/lib/api/schemas';
import {
  nextConversionNo,
  InventoryConversionSequenceMissingError,
  computeBaseQuantity,
  conversionLineDedupeKey,
} from '@/lib/inventory-conversion/helpers';

export const dynamic = 'force-dynamic';

/** GET /api/inventory-conversions（分页 + conversionNo/itemId/status 过滤 + createdAt desc） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'inventory-conversion:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'inventory-conversion.list');

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const conversionNo = searchParams.get('conversionNo')?.trim();
  const itemId = searchParams.get('itemId')?.trim();
  const status = searchParams.get('status')?.trim();

  const where = {
    deletedAt: null,
    ...(conversionNo ? { conversionNo: { contains: conversionNo, mode: 'insensitive' as const } } : {}),
    ...(itemId ? { itemId } : {}),
    ...(status ? { status: status as never } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.inventoryConversion.count({ where }),
    prisma.inventoryConversion.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        item: { select: { id: true, code: true, name: true, model: true } },
        baseUom: { select: { id: true, code: true, symbol: true } },
        executedBy: { select: { id: true, name: true, email: true } },
        _count: { select: { lines: true } },
      },
    }),
  ]);

  return ok({ total, page, pageSize, items });
}

/**
 * POST /api/inventory-conversions —— 创建转换单（DRAFT；**创建即取号 CVT**；红线 DRAFT 不落账）
 * CTO 6B-4 Conversion / Repack Vertical Slice：
 * - **首版边界（CTO 锁死）**：同一 itemId（Repack / UOM Conversion）；一张 Conversion 恰好 1 CONSUME + 1 PRODUCE；
 *   禁止 BOM/组装/拆解/多物料；batch 默认精确继承；serial 不允许（首版不支持 serial 重生成）；
 * - **baseUomId 必须 == 该 Item 的 inventory/stock UOM（P11 Final Gate）**——不允许调用方任意选 UOM 冒充库存基准；
 * - **baseQuantity 由服务端 canonical 计算**（baseQuantity = quantity × uomToBaseRate，Decimal 精度统一）——
 *   不信任客户端提交的 baseQuantity（schema 不收）；
 * - 行级 uomToBaseRate > 0（DB CHECK 兜底）；warehouse/location 组合 FK + uom 校验；
 * - **红线：DRAFT 不落账**（不创建 InventoryMovement / 不更新 StockProjection——只有 Execute 经 Shared Core）。
 */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'inventory-conversion:create');
  if (denied) return denied;
  requestLog(request, user?.id, 'inventory-conversion.create');

  const parsed = inventoryConversionCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const data = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  // ① 行角色校验：恰好 1 CONSUME + 1 PRODUCE（zod length(2) 只保证 2 行，这里校验角色集合）
  const roles = data.lines.map((l) => conversionLineDedupeKey({ lineRole: l.lineRole }));
  if (new Set(roles).size !== 2 || !roles.includes('CONSUME') || !roles.includes('PRODUCE')) {
    return fail(ERROR_CODES.INVENTORY_CONVERSION_LINE_ROLE_REQUIRED, '必须恰好 1 条 CONSUME + 1 条 PRODUCE（单输入单输出）', 400);
  }

  let result:
    | { ok: true; conversion: NonNullable<Awaited<ReturnType<typeof prisma.inventoryConversion.findFirst>>> }
    | { ok: false; error: string }
    | undefined;

  try {
    result = await prisma.$transaction(async (tx) => {
      // ② item 校验（存在 + isActive）
      const item = await tx.item.findFirst({ where: { id: data.itemId, deletedAt: null } });
      if (!item) return { ok: false as const, error: 'ITEM_INVALID' };
      // ③ baseUomId Gate（P11 Final）：必须 == 该 Item 的 inventory/stock UOM
      const itemStockUom = item.stockUomId;
      if (!itemStockUom || itemStockUom !== data.baseUomId) {
        return { ok: false as const, error: 'BASE_UOM_INVALID' };
      }
      const baseUom = await tx.unitOfMeasure.findFirst({ where: { id: data.baseUomId, deletedAt: null } });
      if (!baseUom) return { ok: false as const, error: 'BASE_UOM_INVALID' };

      // ④ 每行：warehouse/location 组合 FK + uom 校验 + quantity>0 + uomToBaseRate>0
      for (const l of data.lines) {
        const wh = await tx.warehouse.findFirst({ where: { id: l.warehouseId, deletedAt: null } });
        if (!wh) return { ok: false as const, error: 'WAREHOUSE_INVALID' };
        if (l.locationId) {
          const loc = await tx.warehouseLocation.findFirst({
            where: { id: l.locationId, warehouseId: l.warehouseId, deletedAt: null },
          });
          if (!loc) return { ok: false as const, error: 'LOCATION_INVALID' };
        }
        const uom = await tx.unitOfMeasure.findFirst({ where: { id: l.uomId, deletedAt: null } });
        if (!uom) return { ok: false as const, error: 'UOM_INVALID' };
        if (l.quantity <= 0) return { ok: false as const, error: 'QUANTITY_INVALID' };
        if (l.uomToBaseRate <= 0) return { ok: false as const, error: 'RATE_INVALID' };
      }
      // ⑤ batch 精确继承：CONSUME 与 PRODUCE 的 batchNo 必须一致（P5 Final 首版不拆批不换批）
      const consume = data.lines.find((l) => l.lineRole === 'CONSUME')!;
      const produce = data.lines.find((l) => l.lineRole === 'PRODUCE')!;
      if ((consume.batchNo ?? null) !== (produce.batchNo ?? null)) {
        return { ok: false as const, error: 'BATCH_MISMATCH' };
      }

      // ⑥ 服务端 canonical 计算 baseQuantity（CTO 锁死①：不信任客户端；Decimal 精度统一）
      // ⑦ 创建（创建即取号 CVT；DRAFT 不落账）
      const conversionNo = await nextConversionNo(tx, new Date());
      const conversion = await tx.inventoryConversion.create({
        data: {
          conversionNo,
          status: 'DRAFT',
          itemId: data.itemId,
          baseUomId: data.baseUomId,
          remark: data.remark ?? null,
          createdById: actorId,
          updatedById: actorId,
          lines: {
            create: data.lines.map((l) => ({
              lineRole: l.lineRole,
              quantity: l.quantity,
              uomId: l.uomId,
              uomToBaseRate: l.uomToBaseRate,
              baseQuantity: computeBaseQuantity(new Prisma.Decimal(l.quantity), new Prisma.Decimal(l.uomToBaseRate)),
              warehouseId: l.warehouseId,
              locationId: l.locationId ?? null,
              batchNo: l.batchNo ?? null,
              remark: l.remark ?? null,
              createdById: actorId,
              updatedById: actorId,
            })),
          },
        },
        include: {
          item: { select: { id: true, code: true, name: true, model: true } },
          baseUom: { select: { id: true, code: true, symbol: true } },
          lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        },
      });
      return { ok: true as const, conversion };
    });
  } catch (err) {
    // CVT DocumentSequence 缺失 = 部署配置错误（fail closed，禁 fallback——CTO Blocking ① 同款治理）
    if (err instanceof InventoryConversionSequenceMissingError) {
      return fail(ERROR_CODES.INVENTORY_CONVERSION_SEQUENCE_MISSING, err.message, 500);
    }
    console.error('[inventory-conversion.create]', err);
    return fail(ERROR_CODES.INTERNAL_ERROR, '创建转换单失败', 500);
  }

  if (!result || result.ok === false) {
    const codeMap: Record<string, { code: ErrorCode; msg: string; status: number }> = {
      ITEM_INVALID: { code: ERROR_CODES.INVENTORY_CONVERSION_ITEM_INVALID, msg: '物料不存在或已停用', status: 400 },
      BASE_UOM_INVALID: { code: ERROR_CODES.INVENTORY_CONVERSION_BASE_UOM_INVALID, msg: 'baseUomId 必须 == 该物料的库存单位（stockUomId）', status: 400 },
      WAREHOUSE_INVALID: { code: ERROR_CODES.INVENTORY_CONVERSION_WAREHOUSE_INVALID, msg: '仓库不存在或已停用', status: 400 },
      LOCATION_INVALID: { code: ERROR_CODES.INVENTORY_CONVERSION_LOCATION_INVALID, msg: '库位不存在或不属于对应仓库', status: 400 },
      UOM_INVALID: { code: ERROR_CODES.INVENTORY_CONVERSION_UOM_INVALID, msg: '业务 UOM 不存在或已停用', status: 400 },
      QUANTITY_INVALID: { code: ERROR_CODES.INVENTORY_CONVERSION_INVALID_STATE, msg: '转换数量必须 > 0', status: 400 },
      RATE_INVALID: { code: ERROR_CODES.INVENTORY_CONVERSION_RATE_INVALID, msg: 'uomToBaseRate 必须 > 0', status: 400 },
      BATCH_MISMATCH: { code: ERROR_CODES.INVENTORY_CONVERSION_BATCH_MISMATCH, msg: 'CONSUME 与 PRODUCE 的 batchNo 必须一致（P5 精确继承，首版不拆批不换批）', status: 400 },
    };
    const entry = result?.ok === false ? codeMap[result.error] : undefined;
    if (entry) return fail(entry.code, entry.msg, entry.status);
    return fail(ERROR_CODES.INTERNAL_ERROR, '创建转换单失败', 500);
  }

  await writeAuditLog({
    actorId,
    action: 'inventory-conversion:create',
    entityType: 'inventory-conversion',
    entityId: result.conversion.id,
    afterData: { conversionNo: result.conversion.conversionNo, status: result.conversion.status, itemId: result.conversion.itemId },
    meta,
  });

  return ok({ conversion: result.conversion }, undefined, 201);
}
