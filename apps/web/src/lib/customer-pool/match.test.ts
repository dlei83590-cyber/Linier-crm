import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: {} as Record<string, unknown> }));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/domain-events/writer', () => ({
  writeDomainEvent: vi.fn().mockResolvedValue(undefined),
}));

import { matchCustomerPools } from '@/lib/customer-pool/match';
import { writeDomainEvent } from '@/lib/domain-events/writer';

type TxMock = {
  customerPoolEntry: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  customerOwnership: { findFirst: ReturnType<typeof vi.fn> };
};

function makeTx(overrides: Partial<TxMock> = {}): TxMock {
  return {
    customerPoolEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'entry-auto-1',
        poolId: 'pool-region-1',
        businessPartnerId: 'bp-1',
        status: 'IN_POOL',
        enterReason: 'FIELD_RULE',
      }),
    },
    customerOwnership: { findFirst: vi.fn().mockResolvedValue(null) },
    ...overrides,
  };
}

describe('matchCustomerPools — 客户公海自动匹配 MVP（REGION scope 触碰规则）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.businessPartner = {
      findFirst: vi.fn().mockResolvedValue({ id: 'bp-1', type: 'CUSTOMER', region: '华东' }),
    };
    mockPrisma.customerPool = {
      findMany: vi.fn().mockResolvedValue([{ id: 'pool-region-1', code: 'POOL-REGION-HD' }]),
    };
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(makeTx()));
  });

  it('REGION scopeValue === BP.region → 自动创建 FIELD_RULE 条目 + Outbox 事件（同事务）', async () => {
    const tx = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));

    const result = await matchCustomerPools('bp-1');

    expect(result.matched).toBe(true);
    expect(result.entryCreated).toBe(true);
    expect(result.entryId).toBe('entry-auto-1');
    expect(result.poolsMatched).toEqual([{ id: 'pool-region-1', code: 'POOL-REGION-HD' }]);
    expect(tx.customerPoolEntry.create).toHaveBeenCalledTimes(1);
    const createArgs = tx.customerPoolEntry.create.mock.calls[0][0];
    expect(createArgs.data.poolId).toBe('pool-region-1');
    expect(createArgs.data.status).toBe('IN_POOL');
    expect(createArgs.data.enterReason).toBe('FIELD_RULE');
    expect(writeDomainEvent).toHaveBeenCalledTimes(1);
    const eventArgs = (writeDomainEvent as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(eventArgs.eventType).toBe('CustomerPoolEntryEntered');
    expect(eventArgs.payload.enterReason).toBe('FIELD_RULE');
    expect(eventArgs.payload.businessPartnerId).toBe('bp-1');
  });

  it('BP region 无命中池 → 不创建（NO_MATCHING_POOL）', async () => {
    mockPrisma.customerPool = { findMany: vi.fn().mockResolvedValue([]) };

    const result = await matchCustomerPools('bp-1');

    expect(result.matched).toBe(false);
    expect(result.entryCreated).toBe(false);
    expect(result.skippedReason).toBe('NO_MATCHING_POOL');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('BP 无 region → 不查询池、不创建（NO_MATCHING_POOL）', async () => {
    mockPrisma.businessPartner = {
      findFirst: vi.fn().mockResolvedValue({ id: 'bp-1', type: 'CUSTOMER', region: null }),
    };

    const result = await matchCustomerPools('bp-1');

    expect(result.skippedReason).toBe('NO_MATCHING_POOL');
    expect(mockPrisma.customerPool.findMany).not.toHaveBeenCalled();
  });

  it('已有 active entry（I2）→ 跳过不重复创建（HAS_ACTIVE_ENTRY）', async () => {
    const tx = makeTx({
      customerPoolEntry: {
        findFirst: vi.fn().mockResolvedValue({ id: 'entry-x' }),
        create: vi.fn(),
      },
    });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));

    const result = await matchCustomerPools('bp-1');

    expect(result.matched).toBe(true);
    expect(result.entryCreated).toBe(false);
    expect(result.skippedReason).toBe('HAS_ACTIVE_ENTRY');
    expect(tx.customerPoolEntry.create).not.toHaveBeenCalled();
  });

  it('已有 active ownership（I1）→ 跳过（HAS_ACTIVE_OWNERSHIP，防已负责客户流入公海）', async () => {
    const tx = makeTx({ customerOwnership: { findFirst: vi.fn().mockResolvedValue({ id: 'own-1' }) } });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));

    const result = await matchCustomerPools('bp-1');

    expect(result.skippedReason).toBe('HAS_ACTIVE_OWNERSHIP');
    expect(tx.customerPoolEntry.create).not.toHaveBeenCalled();
  });

  it('SUPPLIER 客户 → 跳过（NOT_POOL_ELIGIBLE）', async () => {
    mockPrisma.businessPartner = {
      findFirst: vi.fn().mockResolvedValue({ id: 'bp-1', type: 'SUPPLIER', region: '华东' }),
    };

    const result = await matchCustomerPools('bp-1');

    expect(result.skippedReason).toBe('NOT_POOL_ELIGIBLE');
    expect(mockPrisma.customerPool.findMany).not.toHaveBeenCalled();
  });

  it('BP 不存在/已删除 → PARTNER_NOT_FOUND', async () => {
    mockPrisma.businessPartner = { findFirst: vi.fn().mockResolvedValue(null) };

    const result = await matchCustomerPools('bp-x');

    expect(result.skippedReason).toBe('PARTNER_NOT_FOUND');
    expect(mockPrisma.customerPool.findMany).not.toHaveBeenCalled();
  });

  it('并发双入池撞 partial unique P2002 → RACE_LOST no-op（不抛出）', async () => {
    mockPrisma.$transaction = vi.fn().mockRejectedValue(
      Object.assign(new Error('unique constraint'), { code: 'P2002' }),
    );

    const result = await matchCustomerPools('bp-1');

    expect(result.matched).toBe(true);
    expect(result.entryCreated).toBe(false);
    expect(result.skippedReason).toBe('RACE_LOST');
  });
});
