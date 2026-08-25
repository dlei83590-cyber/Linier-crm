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
  executeLedgerAtoms: vi.fn().mockResolvedValue([{ movementId: 'rmv-1', movementNo: 'MV000002', inserted: true }]),
  InventoryInsufficientStockError: class extends Error {},
  InventoryLedgerIdempotencyConflictError: class extends Error {},
}));

import { DELETE } from '@/app/api/deliveries/[id]/route';

/** 合同收口-销售出库：Delivery 删除（DISPATCHED）必须通过 REVERSAL 恢复库存（禁止 delete movement / 无 movement 直接加回投影） */

function makeDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dlv-1',
    code: 'DO000001',
    salesOrderId: 'so-1',
    customerId: 'cus-1',
    status: 'DISPATCHED',
    ...overrides,
  };
}

function makeOutboundMovement(id = 'mv-1') {
  return {
    id,
    warehouseId: 'wh-1',
    locationId: null,
    itemId: 'item-1',
    batchNo: null,
    serialNo: null,
    quantity: new Prisma.Decimal('10'),
    uomId: 'uom-pc',
    movementAtomKey: 'BULK',
    mfgDate: null,
    expDate: null,
  };
}

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/deliveries/dlv-1', {
    method: 'DELETE',
    headers: { authorization: 'Bearer test-token' },
  });
}

type TxMock = {
  $queryRaw: ReturnType<typeof vi.fn>;
  inventoryMovement: { findMany: ReturnType<typeof vi.fn> };
  delivery: { update: ReturnType<typeof vi.fn> };
  deliveryLine: { aggregate: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  deliveryRevision: { updateMany: ReturnType<typeof vi.fn> };
  deliverySnapshot: { updateMany: ReturnType<typeof vi.fn> };
  salesOrderLine: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  salesOrder: { update: ReturnType<typeof vi.fn> };
};

function makeTx(delivery: ReturnType<typeof makeDelivery>, movements: unknown[]): TxMock {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'so-1' }]),
    inventoryMovement: { findMany: vi.fn().mockResolvedValue(movements) },
    delivery: { update: vi.fn().mockResolvedValue(delivery) },
    deliveryLine: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: null } }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    deliveryRevision: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    deliverySnapshot: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    salesOrderLine: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({}) },
    salesOrder: { update: vi.fn().mockResolvedValue({}) },
  };
}

describe('DELETE /api/deliveries/:id — DISPATCHED 删除恢复库存（REVERSAL）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.delivery = { findFirst: vi.fn() };
    mockPrisma.invoice = { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) };
  });

  it('DISPATCHED 删除：找到 SALES_DELIVERY OUT movements → 构造 REVERSAL/IN 原子（reversalOfMovementId 引用原 Movement）→ 恢复库存', async () => {
    mockPrisma.delivery.findFirst = vi.fn().mockResolvedValue(makeDelivery());
    const tx = makeTx(makeDelivery(), [makeOutboundMovement()]);
    mockPrisma.$transaction = vi.fn((fn: any) => fn(tx));
    const { executeLedgerAtoms } = await import('@/lib/inventory-ledger/ledger-command');

    const res = await DELETE(makeRequest(), { params: Promise.resolve({ id: 'dlv-1' }) });
    expect(res.status).toBe(200);

    // 恢复库存：读原 OUT movements
    expect(tx.inventoryMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sourceType: 'SALES_DELIVERY', sourceId: 'dlv-1', direction: 'OUT' } }),
    );
    // 构造 REVERSAL 原子（IN 方向 + reversalOfMovementId + 原五维 + 原数量）
    const atomsArgs = (executeLedgerAtoms as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(atomsArgs).toHaveLength(1);
    const atom = atomsArgs[0];
    expect(atom.sourceType).toBe('REVERSAL');
    expect(atom.direction).toBe('IN');
    expect(atom.movementType).toBe('REVERSAL');
    expect(atom.movementRole).toBe('REVERSAL');
    expect(atom.reversalOfMovementId).toBe('mv-1');
    expect(atom.warehouseId).toBe('wh-1');
    expect(atom.itemId).toBe('item-1');
    expect(atom.quantity.toString()).toBe('10');
    // 软删除同事务
    expect(tx.delivery.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }));
  });

  it('CANCELLED 删除：无 SALES_DELIVERY movements（未发运）→ 不写 REVERSAL，直接软删除', async () => {
    mockPrisma.delivery.findFirst = vi.fn().mockResolvedValue(makeDelivery({ status: 'CANCELLED' }));
    const tx = makeTx(makeDelivery({ status: 'CANCELLED' }), []);
    mockPrisma.$transaction = vi.fn((fn: any) => fn(tx));
    const { executeLedgerAtoms } = await import('@/lib/inventory-ledger/ledger-command');

    const res = await DELETE(makeRequest(), { params: Promise.resolve({ id: 'dlv-1' }) });
    expect(res.status).toBe(200);
    expect(tx.inventoryMovement.findMany).not.toHaveBeenCalled();
    expect(executeLedgerAtoms).not.toHaveBeenCalled();
    expect(tx.delivery.update).toHaveBeenCalled();
  });

  it('DISPATCHED 但无 movements（历史兼容/无库存效应）：跳过 REVERSAL，软删除成功', async () => {
    mockPrisma.delivery.findFirst = vi.fn().mockResolvedValue(makeDelivery());
    const tx = makeTx(makeDelivery(), []);
    mockPrisma.$transaction = vi.fn((fn: any) => fn(tx));
    const { executeLedgerAtoms } = await import('@/lib/inventory-ledger/ledger-command');

    const res = await DELETE(makeRequest(), { params: Promise.resolve({ id: 'dlv-1' }) });
    expect(res.status).toBe(200);
    expect(executeLedgerAtoms).not.toHaveBeenCalled();
    expect(tx.delivery.update).toHaveBeenCalled();
  });

  it('非 CANCELLED/DISPATCHED（DRAFT/READY/DELIVERED）删除：409 DELIVERY_INVALID_STATE', async () => {
    mockPrisma.delivery.findFirst = vi.fn().mockResolvedValue(makeDelivery({ status: 'READY' }));
    const res = await DELETE(makeRequest(), { params: Promise.resolve({ id: 'dlv-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('DELIVERY_INVALID_STATE');
  });
});