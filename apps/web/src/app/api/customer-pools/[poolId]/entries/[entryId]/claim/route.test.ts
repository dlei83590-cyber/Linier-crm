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

import { POST } from '@/app/api/customer-pools/[poolId]/entries/[entryId]/claim/route';

type TxMock = {
  $queryRaw: ReturnType<typeof vi.fn>;
  businessPartner: { findFirst: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
  customerOwnership: { create: ReturnType<typeof vi.fn> };
  customerPoolEntry: { update: ReturnType<typeof vi.fn> };
  outboxMessage: { create: ReturnType<typeof vi.fn> };
};

function makeTx(overrides: Partial<TxMock> = {}): TxMock {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'entry-1', status: 'IN_POOL', businessPartnerId: 'bp-1' }]),
    businessPartner: { findFirst: vi.fn().mockResolvedValue({ id: 'bp-1' }) },
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'u-1', isActive: true }) },
    customerOwnership: { create: vi.fn().mockResolvedValue({ id: 'own-1' }) },
    customerPoolEntry: { update: vi.fn().mockResolvedValue({ id: 'entry-1', status: 'CLAIMED' }) },
    outboxMessage: { create: vi.fn().mockResolvedValue({ id: 'o-1' }) },
    ...overrides,
  };
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/customer-pools/pool-1/entries/entry-1/claim', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function params() {
  return Promise.resolve({ poolId: 'pool-1', entryId: 'entry-1' });
}

describe('POST .../claim — Phase 2C-2 挑入', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.customerPool = { findFirst: vi.fn().mockResolvedValue({ id: 'pool-1', deletedAt: null }) };
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(makeTx()));
  });

  it('claim 成功（201）：ownership + entry=CLAIMED + Outbox CustomerPoolEntryClaimed 同事务', async () => {
    const tx = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest({}), { params: params() });
    expect(res.status).toBe(201);
    expect(tx.customerOwnership.create).toHaveBeenCalledTimes(1);
    const entryUpdate = (tx.customerPoolEntry.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(entryUpdate.data.status).toBe('CLAIMED');
    const outboxArgs = tx.outboxMessage.create.mock.calls[0][0];
    expect(outboxArgs.data.eventType).toBe('CustomerPoolEntryClaimed');
  });

  it('ownerId 代领（assign 权限已 require）：owner 用户 active 才允许', async () => {
    const res = await POST(makeRequest({ ownerId: 'u-2' }), { params: params() });
    expect(res.status).toBe(201);
  });

  it('entry 非 IN_POOL（已被 claim）→ 409 POOL_ENTRY_NOT_CLAIMABLE', async () => {
    const tx = makeTx({ $queryRaw: vi.fn().mockResolvedValue([{ id: 'entry-1', status: 'CLAIMED', businessPartnerId: 'bp-1' }]) });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest({}), { params: params() });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('POOL_ENTRY_NOT_CLAIMABLE');
  });

  it('entry 不存在 → 404 POOL_ENTRY_NOT_FOUND', async () => {
    const tx = makeTx({ $queryRaw: vi.fn().mockResolvedValue([]) });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest({}), { params: params() });
    expect(res.status).toBe(404);
  });

  it('BP 已删 → 409（PARTNER_INACTIVE）', async () => {
    const tx = makeTx({ businessPartner: { findFirst: vi.fn().mockResolvedValue(null) } });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest({}), { params: params() });
    expect(res.status).toBe(409);
  });

  it('owner 用户停用 → 409', async () => {
    const tx = makeTx({ user: { findUnique: vi.fn().mockResolvedValue({ id: 'u-1', isActive: false }) } });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest({}), { params: params() });
    expect(res.status).toBe(409);
  });

  it('并发双 claim → create P2002 → 409 POOL_CLAIM_CONFLICT', async () => {
    const tx = makeTx({
      customerOwnership: {
        create: vi.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002', meta: { target: ['businessPartnerId'] } })),
      },
    });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest({}), { params: params() });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('POOL_CLAIM_CONFLICT');
  });
});
