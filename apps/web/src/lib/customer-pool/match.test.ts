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

describe('matchCustomerPools — 客户公海自动匹配 MVP（REGION + DEPARTMENT scope 触碰规则）', () => {
  let bpFindFirstMock: ReturnType<typeof vi.fn>;
  let ownershipFindFirstMock: ReturnType<typeof vi.fn>;
  let poolFindManyMock: ReturnType<typeof vi.fn>;
  let transactionMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    bpFindFirstMock = vi.fn().mockResolvedValue({ id: 'bp-1', type: 'CUSTOMER', region: '华东' });
    mockPrisma.businessPartner = { findFirst: bpFindFirstMock };
    ownershipFindFirstMock = vi.fn().mockResolvedValue(null);
    mockPrisma.customerOwnership = { findFirst: ownershipFindFirstMock };
    poolFindManyMock = vi.fn().mockResolvedValue([{ id: 'pool-region-1', code: 'POOL-REGION-HD', scopeType: 'REGION' }]);
    mockPrisma.customerPool = { findMany: poolFindManyMock };
    transactionMock = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(makeTx()));
    mockPrisma.$transaction = transactionMock;
  });

  it('REGION scopeValue === BP.region → 自动创建 FIELD_RULE 条目 + Outbox 事件（同事务）', async () => {
    const tx = makeTx();
    transactionMock.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));

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

  it('DEPARTMENT owner→departmentId 命中 → 自动创建 FIELD_RULE 条目（scopeValue = User.departmentId）', async () => {
    // 归属快照：客户负责人（owner）部门 = 销售一部
    ownershipFindFirstMock.mockResolvedValue({ id: 'own-1', owner: { departmentId: 'dept-sale-1' } });
    bpFindFirstMock.mockResolvedValue({ id: 'bp-1', type: 'CUSTOMER', region: null });
    poolFindManyMock.mockResolvedValue([{ id: 'pool-dept-1', code: 'POOL-SALE-1', scopeType: 'DEPARTMENT' }]);
    const tx = makeTx({
      customerOwnership: { findFirst: vi.fn().mockResolvedValue({ owner: { departmentId: 'dept-sale-1' } }) },
    });
    transactionMock.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));

    const result = await matchCustomerPools('bp-1');

    expect(result.matched).toBe(true);
    expect(result.entryCreated).toBe(true);
    expect(result.entryId).toBe('entry-auto-1');
    expect(result.poolsMatched).toEqual([{ id: 'pool-dept-1', code: 'POOL-SALE-1' }]);
    const createArgs = tx.customerPoolEntry.create.mock.calls[0][0];
    expect(createArgs.data.poolId).toBe('pool-dept-1');
    expect(createArgs.data.enterReason).toBe('FIELD_RULE');
    expect(writeDomainEvent).toHaveBeenCalledTimes(1);
  });

  it('DEPARTMENT + REGION 同时命中 → DEPARTMENT（客户负责人部门，触发源）优先入池', async () => {
    ownershipFindFirstMock.mockResolvedValue({ id: 'own-1', owner: { departmentId: 'dept-sale-1' } });
    poolFindManyMock.mockResolvedValue([
      { id: 'pool-region-1', code: 'POOL-REGION-HD', scopeType: 'REGION' },
      { id: 'pool-dept-1', code: 'POOL-SALE-1', scopeType: 'DEPARTMENT' },
    ]);
    const tx = makeTx({
      customerOwnership: { findFirst: vi.fn().mockResolvedValue({ owner: { departmentId: 'dept-sale-1' } }) },
    });
    transactionMock.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));

    const result = await matchCustomerPools('bp-1');

    expect(result.poolsMatched).toEqual([
      { id: 'pool-dept-1', code: 'POOL-SALE-1' },
      { id: 'pool-region-1', code: 'POOL-REGION-HD' },
    ]);
    expect(tx.customerPoolEntry.create.mock.calls[0][0].data.poolId).toBe('pool-dept-1');
  });

  it('BP region 无命中池 → 不创建（NO_MATCHING_POOL）', async () => {
    poolFindManyMock.mockResolvedValue([]);

    const result = await matchCustomerPools('bp-1');

    expect(result.matched).toBe(false);
    expect(result.entryCreated).toBe(false);
    expect(result.skippedReason).toBe('NO_MATCHING_POOL');
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('BP 无 region 且负责人无部门 → 不查询池、不创建（NO_MATCHING_POOL）', async () => {
    bpFindFirstMock.mockResolvedValue({ id: 'bp-1', type: 'CUSTOMER', region: null });
    ownershipFindFirstMock.mockResolvedValue({ id: 'own-1', owner: { departmentId: null } });

    const result = await matchCustomerPools('bp-1');

    expect(result.skippedReason).toBe('NO_MATCHING_POOL');
    expect(poolFindManyMock).not.toHaveBeenCalled();
  });

  it('BP 无 region（无归属）→ 不查询池、不创建（NO_MATCHING_POOL）', async () => {
    bpFindFirstMock.mockResolvedValue({ id: 'bp-1', type: 'CUSTOMER', region: null });

    const result = await matchCustomerPools('bp-1');

    expect(result.skippedReason).toBe('NO_MATCHING_POOL');
    expect(poolFindManyMock).not.toHaveBeenCalled();
  });

  it('已有 active entry（I2）→ 跳过不重复创建（HAS_ACTIVE_ENTRY；REGION 路径）', async () => {
    const tx = makeTx({
      customerPoolEntry: {
        findFirst: vi.fn().mockResolvedValue({ id: 'entry-x' }),
        create: vi.fn(),
      },
    });
    transactionMock.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));

    const result = await matchCustomerPools('bp-1');

    expect(result.matched).toBe(true);
    expect(result.entryCreated).toBe(false);
    expect(result.skippedReason).toBe('HAS_ACTIVE_ENTRY');
    expect(tx.customerPoolEntry.create).not.toHaveBeenCalled();
  });

  it('已有 active entry（I2）→ DEPARTMENT 路径也不重复入池（HAS_ACTIVE_ENTRY）', async () => {
    ownershipFindFirstMock.mockResolvedValue({ id: 'own-1', owner: { departmentId: 'dept-sale-1' } });
    bpFindFirstMock.mockResolvedValue({ id: 'bp-1', type: 'CUSTOMER', region: null });
    poolFindManyMock.mockResolvedValue([{ id: 'pool-dept-1', code: 'POOL-SALE-1', scopeType: 'DEPARTMENT' }]);
    const tx = makeTx({
      customerPoolEntry: {
        findFirst: vi.fn().mockResolvedValue({ id: 'entry-x' }),
        create: vi.fn(),
      },
    });
    transactionMock.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));

    const result = await matchCustomerPools('bp-1');

    expect(result.skippedReason).toBe('HAS_ACTIVE_ENTRY');
    expect(tx.customerPoolEntry.create).not.toHaveBeenCalled();
  });

  it('已有 active ownership（I1）→ REGION 自动入池跳过（HAS_ACTIVE_OWNERSHIP，防已负责客户流入区域公海）', async () => {
    // 归属存在但负责人部门无对应 DEPARTMENT 池 → 仅 REGION 候选 → I1 拦截
    ownershipFindFirstMock.mockResolvedValue({ id: 'own-1', owner: { departmentId: 'dept-other' } });
    const tx = makeTx({ customerOwnership: { findFirst: vi.fn().mockResolvedValue({ id: 'own-1' }) } });
    transactionMock.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));

    const result = await matchCustomerPools('bp-1');

    expect(result.skippedReason).toBe('HAS_ACTIVE_OWNERSHIP');
    expect(tx.customerPoolEntry.create).not.toHaveBeenCalled();
  });

  it('DEPARTMENT 事务内复核失败（归属在判定与提交间释放）→ MATCH_CONDITION_CHANGED 不创建', async () => {
    ownershipFindFirstMock.mockResolvedValue({ id: 'own-1', owner: { departmentId: 'dept-sale-1' } });
    bpFindFirstMock.mockResolvedValue({ id: 'bp-1', type: 'CUSTOMER', region: null });
    poolFindManyMock.mockResolvedValue([{ id: 'pool-dept-1', code: 'POOL-SALE-1', scopeType: 'DEPARTMENT' }]);
    const tx = makeTx({ customerOwnership: { findFirst: vi.fn().mockResolvedValue(null) } });
    transactionMock.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));

    const result = await matchCustomerPools('bp-1');

    expect(result.matched).toBe(false);
    expect(result.skippedReason).toBe('MATCH_CONDITION_CHANGED');
    expect(tx.customerPoolEntry.create).not.toHaveBeenCalled();
  });

  it('SUPPLIER 客户 → 跳过（NOT_POOL_ELIGIBLE）', async () => {
    bpFindFirstMock.mockResolvedValue({ id: 'bp-1', type: 'SUPPLIER', region: '华东' });

    const result = await matchCustomerPools('bp-1');

    expect(result.skippedReason).toBe('NOT_POOL_ELIGIBLE');
    expect(poolFindManyMock).not.toHaveBeenCalled();
  });

  it('BP 不存在/已删除 → PARTNER_NOT_FOUND', async () => {
    bpFindFirstMock.mockResolvedValue(null);

    const result = await matchCustomerPools('bp-x');

    expect(result.skippedReason).toBe('PARTNER_NOT_FOUND');
    expect(poolFindManyMock).not.toHaveBeenCalled();
  });

  it('并发双入池撞 partial unique P2002 → RACE_LOST no-op（不抛出）', async () => {
    transactionMock.mockRejectedValue(Object.assign(new Error('unique constraint'), { code: 'P2002' }));

    const result = await matchCustomerPools('bp-1');

    expect(result.matched).toBe(true);
    expect(result.entryCreated).toBe(false);
    expect(result.skippedReason).toBe('RACE_LOST');
  });
});
