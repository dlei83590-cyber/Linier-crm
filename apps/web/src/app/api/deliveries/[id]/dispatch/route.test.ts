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
  executeLedgerAtoms: vi.fn().mockResolvedValue([{ movementId: 'mv-1', movementNo: 'MV000001', inserted: true }]),
  InventoryInsufficientStockError: class extends Error {},
  InventoryLedgerIdempotencyConflictError: class extends Error {},
}));

import { POST } from '@/app/api/deliveries/[id]/dispatch/route';

/** 合同收口-销售出库：Delivery DISPATCH 路由级测试（READY→DISPATCHED 同事务真正库存扣减） */

function makeDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dlv-1',
    code: 'DO000001',
    salesOrderId: 'so-1',
    customerId: 'cus-1',
    status: 'READY',
    carrier: null,
    trackingNo: null,
    ...overrides,
  };
}

type TxMock = {
  $queryRaw: ReturnType<typeof vi.fn>;
  warehouse: { findFirst: ReturnType<typeof vi.fn> };
  warehouseLocation: { findFirst: ReturnType<typeof vi.fn> };
  deliveryLine: { findMany: ReturnType<typeof vi.fn> };
  delivery: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  deliveryRevision: { findFirst: ReturnType<typeof vi.fn> };
  deliverySnapshot: { create: ReturnType<typeof vi.fn> };
};

function makeTx(delivery: ReturnType<typeof makeDelivery>, lines: unknown[] = []): TxMock {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ id: delivery.id }]),
    warehouse: { findFirst: vi.fn().mockResolvedValue({ id: 'wh-1', name: '成品仓' }) },
    warehouseLocation: { findFirst: vi.fn().mockResolvedValue({ id: 'loc-1', name: 'A区' }) },
    deliveryLine: { findMany: vi.fn().mockResolvedValue(lines) },
    delivery: {
      findFirst: vi.fn().mockResolvedValue(delivery),
      update: vi.fn().mockResolvedValue({ ...delivery, status: 'DISPATCHED' }),
    },
    deliveryRevision: { findFirst: vi.fn().mockResolvedValue(null) },
    deliverySnapshot: { create: vi.fn().mockResolvedValue({}) },
  };
}

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/deliveries/dlv-1/dispatch', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function materialLine(id = 'line-1', itemId = 'item-1', quantity = '10') {
  return { id, itemId, quantity: new Prisma.Decimal(quantity), uomId: 'uom-pc' };
}

describe('POST /api/deliveries/:id/dispatch — 销售出库（DISPATCH 同事务真正库存扣减）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('READY → DISPATCHED：构造 SALES_DELIVERY OUT 原子并执行（五元幂等 + movementGroupId=delivery.id + 出库仓库）', async () => {
    const delivery = makeDelivery();
    const tx = makeTx(delivery, [materialLine()]);
    mockPrisma.$transaction = vi.fn((fn: any) => fn(tx));
    const { executeLedgerAtoms } = await import('@/lib/inventory-ledger/ledger-command');

    const res = await POST(makeRequest({ warehouseId: 'wh-1', changeReason: '发运' }), {
      params: Promise.resolve({ id: 'dlv-1' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('DISPATCHED');
    expect(body.data.outboundAtoms).toHaveLength(1);

    const atomsArgs = (executeLedgerAtoms as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(atomsArgs).toHaveLength(1);
    const atom = atomsArgs[0];
    // 五元幂等
    expect(atom.sourceType).toBe('SALES_DELIVERY');
    expect(atom.sourceId).toBe('dlv-1');
    expect(atom.sourceLineId).toBe('line-1');
    expect(atom.movementRole).toBe('OUT');
    expect(atom.movementAtomKey).toBe('BULK');
    // 编组 + 方向 + 仓库维度 + 数量
    expect(atom.movementGroupId).toBe('dlv-1');
    expect(atom.direction).toBe('OUT');
    expect(atom.movementType).toBe('OUTBOUND');
    expect(atom.warehouseId).toBe('wh-1');
    expect(atom.itemId).toBe('item-1');
    expect(atom.quantity.toString()).toBe('10');
    expect(atom.referenceNo).toBe('DO000001');
    // 状态更新 + 快照（同事务）
    expect(tx.delivery.update).toHaveBeenCalled();
  });

  it('多行：全部物料行生成原子，非物料行（itemId=null）跳过', async () => {
    const delivery = makeDelivery();
    const tx = makeTx(delivery, [materialLine('line-1', 'item-1', '5'), materialLine('line-2', 'item-2', '3'), { id: 'line-3', itemId: null, quantity: new Prisma.Decimal('1'), uomId: null }]);
    mockPrisma.$transaction = vi.fn((fn: any) => fn(tx));
    const { executeLedgerAtoms } = await import('@/lib/inventory-ledger/ledger-command');

    const res = await POST(makeRequest({ warehouseId: 'wh-1' }), { params: Promise.resolve({ id: 'dlv-1' }) });
    expect(res.status).toBe(200);
    const atomsArgs = (executeLedgerAtoms as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(atomsArgs).toHaveLength(2);
    expect(atomsArgs[0].sourceLineId).toBe('line-1');
    expect(atomsArgs[1].sourceLineId).toBe('line-2');
    // 同一 movementGroupId（一次 DISPATCH 归组）
    expect(atomsArgs[0].movementGroupId).toBe(atomsArgs[1].movementGroupId);
  });

  it('库存不足：executeLedgerAtoms 抛 InventoryInsufficientStockError → 409 INVENTORY_INSUFFICIENT_STOCK（单据保持 READY）', async () => {
    const delivery = makeDelivery();
    const tx = makeTx(delivery, [materialLine()]);
    mockPrisma.$transaction = vi.fn((fn: any) => fn(tx));
    const { executeLedgerAtoms, InventoryInsufficientStockError } = await import('@/lib/inventory-ledger/ledger-command');
    (executeLedgerAtoms as ReturnType<typeof vi.fn>).mockRejectedValue(
      new InventoryInsufficientStockError('库存不足：onHandQty(5) < OUT quantity(10)'),
    );

    const res = await POST(makeRequest({ warehouseId: 'wh-1' }), { params: Promise.resolve({ id: 'dlv-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('INVENTORY_INSUFFICIENT_STOCK');
    expect(tx.delivery.update).not.toHaveBeenCalled(); // 事务回滚，状态不推进
  });

  it('重复 dispatch（已 DISPATCHED）：409 DELIVERY_INVALID_STATE 幂等拒绝', async () => {
    const delivery = makeDelivery({ status: 'DISPATCHED' });
    const tx = makeTx(delivery, [materialLine()]);
    mockPrisma.$transaction = vi.fn((fn: any) => fn(tx));
    const { executeLedgerAtoms } = await import('@/lib/inventory-ledger/ledger-command');

    const res = await POST(makeRequest({ warehouseId: 'wh-1' }), { params: Promise.resolve({ id: 'dlv-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('DELIVERY_INVALID_STATE');
    expect(executeLedgerAtoms).not.toHaveBeenCalled(); // 状态门禁先于库存扣减
  });

  it('出库仓库缺失：400 VALIDATION_ERROR（schema warehouseId 必填）', async () => {
    const delivery = makeDelivery();
    const tx = makeTx(delivery, [materialLine()]);
    mockPrisma.$transaction = vi.fn((fn: any) => fn(tx));
    const { executeLedgerAtoms } = await import('@/lib/inventory-ledger/ledger-command');

    const res = await POST(makeRequest({}), { params: Promise.resolve({ id: 'dlv-1' }) });
    expect(res.status).toBe(400);
    expect(executeLedgerAtoms).not.toHaveBeenCalled();
  });

  it('出库仓库不存在或已停用：400（仓库维度 canonical 校验）', async () => {
    const delivery = makeDelivery();
    const tx = makeTx(delivery, [materialLine()]);
    tx.warehouse.findFirst = vi.fn().mockResolvedValue(null);
    mockPrisma.$transaction = vi.fn((fn: any) => fn(tx));
    const { executeLedgerAtoms } = await import('@/lib/inventory-ledger/ledger-command');

    const res = await POST(makeRequest({ warehouseId: 'wh-x' }), { params: Promise.resolve({ id: 'dlv-1' }) });
    expect(res.status).toBe(400);
    expect(executeLedgerAtoms).not.toHaveBeenCalled();
  });

  it('幂等 immutable-fact 冲突：InventoryLedgerIdempotencyConflictError → 409', async () => {
    const delivery = makeDelivery();
    const tx = makeTx(delivery, [materialLine()]);
    mockPrisma.$transaction = vi.fn((fn: any) => fn(tx));
    const { executeLedgerAtoms, InventoryLedgerIdempotencyConflictError } = await import('@/lib/inventory-ledger/ledger-command');
    (executeLedgerAtoms as ReturnType<typeof vi.fn>).mockRejectedValue(
      new InventoryLedgerIdempotencyConflictError('幂等身份相同但 immutable 事实不一致'),
    );

    const res = await POST(makeRequest({ warehouseId: 'wh-1' }), { params: Promise.resolve({ id: 'dlv-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('DELIVERY_INVALID_STATE');
  });

  it('物料行数量 ≤ 0：409 DELIVERY_INVALID_STATE（禁止 0/负数量出库；对齐 ready INVALID_LINE_QTY 语义）', async () => {
    const delivery = makeDelivery();
    const tx = makeTx(delivery, [materialLine('line-1', 'item-1', '0')]);
    mockPrisma.$transaction = vi.fn((fn: any) => fn(tx));
    const { executeLedgerAtoms } = await import('@/lib/inventory-ledger/ledger-command');

    const res = await POST(makeRequest({ warehouseId: 'wh-1' }), { params: Promise.resolve({ id: 'dlv-1' }) });
    expect(res.status).toBe(409);
    expect(executeLedgerAtoms).not.toHaveBeenCalled();
  });
});