import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, parsePagination } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { stockCountCreateSchema } from '@/lib/api/schemas';
import { nextCountNo, StockCountSequenceMissingError } from '@/lib/stock-count/helpers';

export const dynamic = 'force-dynamic';

/** GET /api/stock-counts（分页 + countNo/status 过滤 + createdAt desc） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'stock-count:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'stock-count.list');

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const countNo = searchParams.get('countNo')?.trim();
  const status = searchParams.get('status')?.trim();

  const where = {
    deletedAt: null,
    ...(countNo ? { countNo: { contains: countNo, mode: 'insensitive' as const } } : {}),
    ...(status ? { status: status as never } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.stockCount.count({ where }),
    prisma.stockCount.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        countedBy: { select: { id: true, name: true, email: true } },
        _count: { select: { lines: true } },
      },
    }),
  ]);

  return ok({ total, page, pageSize, items });
}

/**
 * POST /api/stock-counts —— 创建盘点单（DRAFT；**创建即取号 CNT**；Count 本身不产生 Movement，差异经 Adjustment 落账）
 * CTO 6B-3 Count + Adjustment 事实链：
 * - **红线：StockCount 永不直接修改 StockProjection**（实盘事实 ≠ 库存账事实）；
 * - freezeStrategy=DYNAMIC（P6 Final：不冻结维度，per-line atomic snapshot）；
 * - 状态机：DRAFT → COUNTING → COMPLETED → ADJUSTED / CANCELLED；
 * - 差异处理：非零差异 → 系统默认生成 COUNT_VARIANCE Adjustment（仍需审批，maker-checker）；
 *   零差异 → 直接 COMPLETED（无 Adjustment）；
 * - **红线：DRAFT 不落账**（不创建 InventoryMovement / 不更新 StockProjection）。
 */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'stock-count:create');
  if (denied) return denied;
  requestLog(request, user?.id, 'stock-count.create');

  const parsed = stockCountCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const data = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  try {
    const countNo = await nextCountNo(prisma);
    const count = await prisma.stockCount.create({
      data: {
        countNo,
        status: 'DRAFT',
        freezeStrategy: 'DYNAMIC',
        remark: data.remark ?? null,
        createdById: actorId,
        updatedById: actorId,
      },
      include: {
        countedBy: { select: { id: true, name: true, email: true } },
      },
    });

    await writeAuditLog({
      actorId,
      action: 'stock-count:create',
      entityType: 'stock-count',
      entityId: count.id,
      afterData: { countNo: count.countNo, status: count.status },
      meta,
    });

    return ok({ count }, undefined, 201);
  } catch (err) {
    // CTO Transfer Review Blocking ① 同款治理：CNT DocumentSequence 缺失 = 部署配置错误（fail closed，禁 fallback）
    if (err instanceof StockCountSequenceMissingError) {
      return fail(ERROR_CODES.STOCK_COUNT_SEQUENCE_MISSING, err.message, 500);
    }
    console.error('[stock-count.create]', err);
    return fail(ERROR_CODES.INTERNAL_ERROR, '创建盘点单失败', 500);
  }
}
