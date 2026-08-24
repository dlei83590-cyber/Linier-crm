import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: {} as Record<string, unknown> }));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/api-helpers', () => ({
  authenticate: vi.fn().mockResolvedValue({ id: 'u-1', email: 'a@b.c', roles: ['SUPER_ADMIN'], departmentId: 'dept-1' }),
  requirePermission: vi.fn().mockReturnValue(null),
  requestMeta: vi.fn().mockReturnValue({ requestId: 'req-1' }),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  requestLog: vi.fn(),
}));

import { POST, GET } from '@/app/api/customer-pools/[id]/entries/route';

type TxMock = {
  customerOwnership: { findFirst: ReturnType<typeof vi.fn> };
  customerPoolEntry: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  outboxMessage: { create: ReturnType<typeof vi.fn> };
};

function makeTx(overrides: Partial<TxMock> = {}): TxMock {
  return {
    customerOwnership: { findFirst: vi.fn().mockResolvedValue(null) },
    customerPoolEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'entry-1', poolId: 'pool-1', businessPartnerId: 'bp-1', status: 'IN_POOL', enterReason: 'MANUAL' }),
    },
    outboxMessage: { create: vi.fn().mockResolvedValue({ id: 'outbox-1' }) },
    ...overrides,
  };
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/customer-pools/pool-1/entries', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function postEntry(body: unknown) {
  return POST(makeRequest(body), { params: Promise.resolve({ id: 'pool-1' }) });
}

function setupPool(partial: Partial<{ isActive: boolean; scopeType: string; scopeValue: string | null }> = {}) {
  mockPrisma.customerPool = {
    findFirst: vi.fn().mockResolvedValue({
      id: 'pool-1', code: 'POOL-G', name: '全球池', scopeType: 'GLOBAL', scopeValue: null, isActive: true,
      ...partial,
    }),
  };
}

describe('POST /api/customer-pools/:id/entries — 手工入池（CTO 全校验）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupPool();
    mockPrisma.businessPartner = {
      findFirst: vi.fn().mockResolvedValue({ id: 'bp-1', type: 'CUSTOMER', region: '华东' }),
    };
    mockPrisma.customerPoolEntry = { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) };
    mockPrisma.user = { findUnique: vi.fn().mockResolvedValue({ id: 'u-1', departmentId: 'dept-1' }) };
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(makeTx()));
  });

  it('GLOBAL 池 + CUSTOMER 客户手工入池成功（201）+ Outbox 同事务事件', async () => {
    const tx = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await postEntry({ businessPartnerId: 'bp-1' }));
    expect(res.status).toBe(201);
    expect(tx.outboxMessage.create).toHaveBeenCalledTimes(1);
    const outboxArgs = tx.outboxMessage.create.mock.calls[0][0];
    expect(outboxArgs.data.eventType).toBe('CustomerPoolEntryEntered');
  });

  it('BP 不存在 → 404', async () => {
    mockPrisma.businessPartner = { findFirst: vi.fn().mockResolvedValue(null) };
    const res = await postEntry({ businessPartnerId: 'bp-x' }));
    expect(res.status).toBe(404);
  });

  it('SUPPLIER 客户 → 400 POOL_ENTRY_NOT_ALLOWED（仅 CUSTOMER/BOTH）', async () => {
    mockPrisma.businessPartner = { findFirst: vi.fn().mockResolvedValue({ id: 'bp-1', type: 'SUPPLIER', region: null }) };
    const res = await postEntry({ businessPartnerId: 'bp-1' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('POOL_ENTRY_NOT_ALLOWED');
  });

  it('池已停用 → 400', async () => {
    setupPool({ isActive: false });
    const res = await postEntry({ businessPartnerId: 'bp-1' }));
    expect(res.status).toBe(400);
  });

  it('REGION scope 与 BP.region 不匹配 → 400', async () => {
    setupPool({ scopeType: 'REGION', scopeValue: '华南' });
    const res = await postEntry({ businessPartnerId: 'bp-1' }));
    expect(res.status).toBe(400);
  });

  it('REGION scope 匹配 → 201', async () => {
    setupPool({ scopeType: 'REGION', scopeValue: '华东' });
    const res = await postEntry({ businessPartnerId: 'bp-1' }));
    expect(res.status).toBe(201);
  });

  it('DEPARTMENT scope 与操作者部门匹配 → 201；不匹配 → 400', async () => {
    setupPool({ scopeType: 'DEPARTMENT', scopeValue: 'dept-1' });
    expect((await postEntry({ businessPartnerId: 'bp-1' }))).status).toBe(201);
    setupPool({ scopeType: 'DEPARTMENT', scopeValue: 'dept-999' });
    expect((await postEntry({ businessPartnerId: 'bp-1' }))).status).toBe(400);
  });

  it('已有 active ownership → 409 CUSTOMER_ALREADY_OWNED', async () => {
    const tx = makeTx({ customerOwnership: { findFirst: vi.fn().mockResolvedValue({ id: 'own-1' }) } });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await postEntry({ businessPartnerId: 'bp-1' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CUSTOMER_ALREADY_OWNED');
  });

  it('已有 active entry → 409 CUSTOMER_ALREADY_IN_POOL', async () => {
    const tx = makeTx({ customerPoolEntry: { findFirst: vi.fn().mockResolvedValue({ id: 'entry-x' }), create: vi.fn() } });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await postEntry({ businessPartnerId: 'bp-1' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CUSTOMER_ALREADY_IN_POOL');
  });

  it('并发双入池 → create P2002 → 409 CUSTOMER_ALREADY_IN_POOL', async () => {
    const tx = makeTx({
      customerPoolEntry: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002', meta: { target: ['businessPartnerId'] } })),
      },
    });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await postEntry({ businessPartnerId: 'bp-1' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CUSTOMER_ALREADY_IN_POOL');
  });
});

describe('GET /api/customer-pools/:id/entries — 列表', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupPool();
    mockPrisma.customerPoolEntry = {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([{ id: 'entry-1', status: 'IN_POOL' }]),
    };
  });

  it('返回分页条目', async () => {
    const res = await GET(new NextRequest('http://localhost/api/customer-pools/pool-1/entries?status=IN_POOL'), { params: Promise.resolve({ id: 'pool-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.total).toBe(1);
  });

  it('pool 不存在 → 404', async () => {
    mockPrisma.customerPool = { findFirst: vi.fn().mockResolvedValue(null) };
    const res = await GET(new NextRequest('http://localhost/api/customer-pools/pool-x/entries'), { params: Promise.resolve({ id: 'pool-x' }) });
    expect(res.status).toBe(404);
  });
});
