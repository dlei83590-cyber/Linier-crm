import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: {} as Record<string, unknown> }));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/api-helpers', () => ({
  authenticate: vi.fn().mockResolvedValue({ id: 'u-1', email: 'a@b.c', roles: ['SUPER_ADMIN'] }),
  requirePermission: vi.fn().mockReturnValue(null),
  requestMeta: vi.fn().mockReturnValue({ requestId: 'req-1' }),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  requestLog: vi.fn(),
}));
vi.mock('@/lib/inventory-ledger/ledger-command', () => ({
  executeLedgerAtoms: vi.fn().mockResolvedValue([
    { movementId: 'mv-1', movementNo: 'MV000001', inserted: true },
    { movementId: 'mv-2', movementNo: 'MV000002', inserted: true },
  ]),
  InventoryInsufficientStockError: class extends Error {},
  InventoryLedgerIdempotencyConflictError: class extends Error {},
}));
vi.mock('@/lib/inventory-cost/moving-average', () => ({
  upsertInboundCost: vi.fn().mockResolvedValue({ ok: true, onHandQty: '1', totalCost: '5', avgUnitCost: '5', idempotent: false }),
}));

import { POST } from '@/app/api/production-orders/[id]/post/route';

/** P-1 Item Sourcing：ProductionOrder POST 路由级测试（SUBMITTED → POSTED 同事务事实边界） */

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderNo: 'PRD000001',
    productionType: 'SELF_MANUFACTURE',
    bomId: null,
    finishedItemId: 'fg-1',
    plannedQty: new Prisma.Decimal('10'),
    warehouseId: 'wh-1',
    supplierId: null,
    processingFee: null,
    batchNo: 'B-1',
    status: 'SUBMITTED',
    movementGroupId: null,
    version: 1,
    lines: [
      { id: 'line-m1', lineType: 'MATERIAL', itemId: 'raw-1', uomId: 'uom-ton', quantity: new Prisma.Decimal('5'), warehouseId: 'wh-1' },
      { id: 'line-f1', lineType: 'FINISHED', itemId: 'fg-1', uomId: 'uom-pc', quantity: new Prisma.Decimal('10'), warehouseId: null },
    ],
    ...overrides,
  };
}

function makeTx(order: ReturnType<typeof makeOrder>) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ id: order.id }]),
    productionOrder: {
      findFirst: vi.fn().mockResolvedValue(order),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirstOrThrow: vi.fn().mockResolvedValue({ ...order, status: 'POSTED', movementGroupId: 'grp-1', postedAt: new Date() }),
    },
    itemBomLine: { findMany: vi.fn().mockResolvedValue([]) },
    inventoryCostBalance: { findFirst: vi.fn().mockResolvedValue(null) },
    productionOrderLine: { update: vi.fn().mockResolvedValue({}) },
  } as unknown as Prisma.TransactionClient;
}

function makeRequest(version: number): NextRequest {
  return new NextRequest('http://localhost/api/production-orders/order-1/post', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({ version }),
  });
}

describe('POST /api/production-orders/:id/post — 过账（同事务库存效应）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SUBMITTED → POSTED：原料 OUT + 成品 IN atoms 执行 + 成品成本入层 + CAS 回写', async () => {
    const order = makeOrder();
    const tx = makeTx(order);
    mockPrisma.$transaction = vi.fn((fn: any) => fn(tx));
    const { executeLedgerAtoms } = await import('@/lib/inventory-ledger/ledger-command');
    const { upsertInboundCost } = await import('@/lib/inventory-cost/moving-average');

    const res = await POST(makeRequest(1), { params: Promise.resolve({ id: 'order-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('POSTED');
    expect(body.data.movementGroupId).toBeTruthy();

    const atomsArgs = (executeLedgerAtoms as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(atomsArgs).toHaveLength(2);
    expect(atomsArgs[0].direction).toBe('OUT'); // 原料领料
    expect(atomsArgs[0].itemId).toBe('raw-1');
    expect(atomsArgs[1].direction).toBe('IN'); // 成品入库
    expect(atomsArgs[1].itemId).toBe('fg-1');
    // 同一 movementGroupId（稳定业务事实）
    expect(atomsArgs[0].movementGroupId).toBe(atomsArgs[1].movementGroupId);

    const costArgs = (upsertInboundCost as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(costArgs.itemId).toBe('fg-1');
    expect(costArgs.sourceKey).toBe('COST:PRODUCTION_ORDER:line-f1');
    expect(costArgs.baseAmount.toString()).toBe('0.00'); // 无成本层原料 → 0 成本
  });

  it('POSTED 重复过账 → 409 幂等拒绝', async () => {
    const order = makeOrder({ status: 'POSTED', movementGroupId: 'grp-x' });
    const tx = makeTx(order);
    mockPrisma.$transaction = vi.fn((fn: any) => fn(tx));
    const res = await POST(makeRequest(1), { params: Promise.resolve({ id: 'order-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('PRODUCTION_ORDER_ALREADY_POSTED');
  });

  it('DRAFT 过账 → 409 INVALID_STATE（仅 SUBMITTED）', async () => {
    const order = makeOrder({ status: 'DRAFT' });
    const tx = makeTx(order);
    mockPrisma.$transaction = vi.fn((fn: any) => fn(tx));
    const res = await POST(makeRequest(1), { params: Promise.resolve({ id: 'order-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('PRODUCTION_ORDER_INVALID_STATE');
  });

  it('有 BOM 且原料行数量 < 配方需求量 → 400 BOM_REQUIREMENT', async () => {
    const order = makeOrder({ bomId: 'bom-1' });
    const tx = makeTx(order);
    tx.itemBomLine = { findMany: vi.fn().mockResolvedValue([
      { componentItemId: 'raw-1', qtyPerFinishedUnit: new Prisma.Decimal('1'), lossRate: new Prisma.Decimal('0.02') },
    ]) };
    mockPrisma.$transaction = vi.fn((fn: any) => fn(tx));
    // 需求量 = 10 × 1 × 1.02 = 10.2 > 5 → 拒绝
    const res = await POST(makeRequest(1), { params: Promise.resolve({ id: 'order-1' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('PRODUCTION_ORDER_BOM_REQUIREMENT');
  });
});
