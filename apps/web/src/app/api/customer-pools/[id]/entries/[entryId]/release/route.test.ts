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

import { POST } from '@/app/api/customer-pools/[poolId]/entries/[entryId]/release/route';

type TxMock = {
  $queryRaw: ReturnType<typeof vi.fn>;
  customerOwnership: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  customerPoolEntry: { update: ReturnType<typeof vi.fn> };
  outboxMessage: { create: ReturnType<typeof vi.fn> };
};

function makeTx(overrides: Partial<TxMock> = {}): TxMock {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'entry-1', status: 'CLAIMED', businessPartnerId: 'bp-1' }]),
    customerOwnership: {
      findFirst: vi.fn().mockResolvedValue({ id: 'own-1' }),
      update: vi.fn().mockResolvedValue({ id: 'own-1' }),
    },
    customerPoolEntry: { update: vi.fn().mockResolvedValue({ id: 'entry-1', status: 'IN_POOL' }) },
    outboxMessage: { create: vi.fn().mockResolvedValue({ id: 'o-1' }) },
    ...overrides,
  };
}

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/customer-pools/pool-1/entries/entry-1/release', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
}

function params() {
  return Promise.resolve({ poolId: 'pool-1', entryId: 'entry-1' });
}

describe('POST .../release — Phase 2C-2 释放回公海（单一语义，CTO MVP）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.customerPool = { findFirst: vi.fn().mockResolvedValue({ id: 'pool-1', deletedAt: null }) };
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(makeTx()));
  });

  it('释放回池：ownership.releasedAt=now + entry=IN_POOL + Outbox', async () => {
    const tx = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest(), { params: params() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.entryStatus).toBe('IN_POOL');
    const entryUpdate = (tx.customerPoolEntry.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(entryUpdate.data.status).toBe('IN_POOL');
    expect(tx.outboxMessage.create).toHaveBeenCalledTimes(1);
  });

  it('无有效归属可释放 → 409 POOL_ENTRY_NOT_CLAIMABLE', async () => {
    const tx = makeTx({ customerOwnership: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() } });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest(), { params: params() });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('POOL_ENTRY_NOT_CLAIMABLE');
  });
});
