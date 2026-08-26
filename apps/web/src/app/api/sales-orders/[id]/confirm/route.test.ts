import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: {} as Record<string, unknown> }));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/api-helpers', () => ({
  authenticate: vi.fn().mockResolvedValue({ id: 'u-1', email: 'a@b.c', roles: ['SUPER_ADMIN'] }),
  requirePermission: vi.fn().mockReturnValue(null),
  requestMeta: vi.fn().mockReturnValue({ requestId: 'req-1' }),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  requestLog: vi.fn(),
}));
vi.mock('@/lib/domain-events/writer', () => ({
  writeDomainEvent: vi.fn().mockResolvedValue(undefined),
}));

import { writeDomainEvent } from '@/lib/domain-events/writer';
import { POST } from '@/app/api/sales-orders/[id]/confirm/route';

const salesOrderRow = {
  id: 'so-1',
  code: 'SO-2026-0001',
  quotationId: 'q-1',
  customerId: 'bp-1',
  projectId: null,
  status: 'DRAFT',
  currency: 'CNY',
  totalAmount: { toString: () => '123456.78' },
  workflowInstanceId: null,
  approvalStatus: 'APPROVED',
  createdById: 'u-2',
  createdAt: new Date(),
  updatedAt: new Date(),
};

type TxMock = {
  salesOrder: { update: ReturnType<typeof vi.fn> };
  salesOrderRevision: { findFirst: ReturnType<typeof vi.fn> };
  salesOrderSnapshot: { create: ReturnType<typeof vi.fn> };
  businessPartner: { findFirst: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
};

function makeTx(overrides: Partial<TxMock> = {}): TxMock {
  return {
    salesOrder: { update: vi.fn().mockResolvedValue({ ...salesOrderRow, status: 'CONFIRMED' }) },
    salesOrderRevision: { findFirst: vi.fn().mockResolvedValue(null) },
    salesOrderSnapshot: { create: vi.fn().mockResolvedValue({ id: 'snap-1' }) },
    businessPartner: { findFirst: vi.fn().mockResolvedValue({ id: 'bp-1', name: '上海示例客户', collaborationChannelKey: 'sales-group' }) },
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'u-2', name: '李四' }) },
    ...overrides,
  };
}

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/sales-orders/so-1/confirm', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
  });
}

describe('POST /api/sales-orders/:id/confirm — ORDER_STAGE_CHANGED Outbox（Migration 0055）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.salesOrder = { findFirst: vi.fn().mockResolvedValue(salesOrderRow) };
  });

  it('确认成功 + 客户配置协同群 → 同事务写 ORDER_STAGE_CHANGED（CONFIRMED，幂等键=订单+阶段）', async () => {
    const tx = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'so-1' }) });
    expect(res.status).toBe(200);
    expect(writeDomainEvent).toHaveBeenCalledTimes(1);
    const envelope = (writeDomainEvent as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(envelope.eventType).toBe('ORDER_STAGE_CHANGED');
    expect(envelope.aggregateType).toBe('SalesOrder');
    expect(envelope.aggregateId).toBe('so-1');
    expect(envelope.idempotencyKey).toBe('ORDER_STAGE_CHANGED|so-1|CONFIRMED');
    expect(envelope.payload.stage).toBe('CONFIRMED');
    expect(envelope.payload.stageLabel).toBe('已确认');
    expect(envelope.payload.salesOrderCode).toBe('SO-2026-0001');
    expect(envelope.payload.customerName).toBe('上海示例客户');
    expect(envelope.payload.totalAmount).toBe('123456.78');
    expect(envelope.payload.ownerName).toBe('李四');
    expect(envelope.payload.channelKey).toBe('sales-group');
  });

  it('确认成功 + 未配置协同群 → 不写 ORDER_STAGE_CHANGED（订单业务事实不受影响）', async () => {
    const tx = makeTx();
    tx.businessPartner.findFirst.mockResolvedValue({ id: 'bp-1', name: '上海示例客户', collaborationChannelKey: null });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'so-1' }) });
    expect(res.status).toBe(200);
    expect(writeDomainEvent).not.toHaveBeenCalled();
  });

  it('已确认订单 → 409（不写 Outbox）', async () => {
    mockPrisma.salesOrder = { findFirst: vi.fn().mockResolvedValue({ ...salesOrderRow, status: 'CONFIRMED' }) };
    mockPrisma.$transaction = vi.fn();
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'so-1' }) });
    expect(res.status).toBe(409);
    expect(writeDomainEvent).not.toHaveBeenCalled();
  });
});
