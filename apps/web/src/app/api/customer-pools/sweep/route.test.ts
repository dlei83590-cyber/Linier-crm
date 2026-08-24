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
vi.mock('@/lib/customer-pool/evaluate-and-sync', () => ({ syncPartnerToPool: vi.fn() }));

import { POST } from '@/app/api/customer-pools/sweep/route';
import { syncPartnerToPool } from '@/lib/customer-pool/evaluate-and-sync';

const syncMock = syncPartnerToPool as unknown as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/customer-pools/sweep', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/customer-pools/sweep — Phase 2C-2 全量重算', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.businessPartner = {
      findMany: vi.fn().mockResolvedValue([{ id: 'bp-1' }, { id: 'bp-2' }, { id: 'bp-3' }]),
    };
    syncMock.mockResolvedValue('UNCHANGED');
  });

  it('返回统计：scanned/entered/unchanged/ambiguous/blocked/failed + batchSize + hasMore', async () => {
    syncMock.mockImplementation(async (id: string) => {
      if (id === 'bp-1') return 'ENTERED';
      if (id === 'bp-2') return 'AMBIGUOUS';
      if (id === 'bp-3') return 'FAILED';
      return 'UNCHANGED';
    });
    const res = await POST(makeRequest({ limit: 200 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.scanned).toBe(3);
    expect(body.data.entered).toBe(1);
    expect(body.data.ambiguous).toBe(1);
    expect(body.data.failed).toBe(1);
    expect(body.data.unchanged).toBe(0);
    expect(body.data.blocked).toBe(0);
    expect(body.data.hasMore).toBe(false);
  });

  it('INELIGIBLE → blocked 统计', async () => {
    syncMock.mockResolvedValue('INELIGIBLE');
    const res = await POST(makeRequest({}));
    const body = await res.json();
    expect(body.data.scanned).toBe(3);
    expect(body.data.blocked).toBe(3);
  });

  it('批量上限：每候选独立事务（sync 被逐个调用，非单长事务）', async () => {
    await POST(makeRequest({ limit: 200 }));
    expect(syncMock).toHaveBeenCalledTimes(3);
  });

  it('候选按 id 排序（锁序红线）', async () => {
    await POST(makeRequest({}));
    const args = (mockPrisma.businessPartner.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.orderBy).toEqual({ id: 'asc' });
    expect(args.take).toBe(200);
  });

  it('limit 上限 500（防全表长事务）', async () => {
    await POST(makeRequest({ limit: 999 }));
    const args = (mockPrisma.businessPartner.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.take).toBe(500);
  });
});
