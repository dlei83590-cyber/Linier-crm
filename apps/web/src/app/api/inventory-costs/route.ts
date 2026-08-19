import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission } from '@/lib/api-helpers';
import { ok } from '@/lib/api/response';
import { requestLog } from '@/lib/api/logger';
import { parsePagination } from '@/lib/api/response';

export const dynamic = 'force-dynamic';

/** GET /api/inventory-costs — 库存成本（移动加权平均）只读列表（D9 解除，ADR-0038；inventory-cost:view） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'inventory-cost:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'inventory-cost.list');

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const itemId = searchParams.get('itemId')?.trim();
  const itemCode = searchParams.get('itemCode')?.trim();

  const where = {
    ...(itemId ? { itemId } : {}),
    ...(itemCode ? { item: { code: { contains: itemCode, mode: 'insensitive' as const } } } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.inventoryCostBalance.count({ where }),
    prisma.inventoryCostBalance.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip,
      take,
      include: { item: { select: { id: true, code: true, name: true, model: true } } },
    }),
  ]);

  const rows = items.map((b) => ({
    id: b.id,
    itemId: b.itemId,
    itemCode: b.item?.code ?? null,
    itemName: b.item?.name ?? null,
    itemModel: b.item?.model ?? null,
    onHandQty: b.onHandQty.toString(),
    totalCost: b.totalCost.toString(),
    avgUnitCost: b.avgUnitCost.toString(),
    updatedAt: b.updatedAt,
  }));

  return ok(rows, { page, pageSize, total });
}
