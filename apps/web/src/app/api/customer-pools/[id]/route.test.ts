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
vi.mock('@/lib/api/cas', () => ({ casUpdate: vi.fn() }));

import { GET, PATCH, DELETE } from '@/app/api/customer-pools/[id]/route';
import { casUpdate } from '@/lib/api/cas';

const casMock = casUpdate as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown, method = "POST"): NextRequest {
  return new NextRequest('http://localhost/api/customer-pools/pool-1', {
    method,
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const poolRow = { id: 'pool-1', code: 'POOL-G', name: '全球池', scopeType: 'GLOBAL', scopeValue: null, isActive: true, version: 1, deletedAt: null };

describe('GET /api/customer-pools/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.customerPool = {
      findFirst: vi.fn().mockResolvedValue({ ...poolRow, rules: [] }),
      findUnique: vi.fn(),
      update: vi.fn(),
    };
  });
  it('存在 → 200', async () => {
    const res = await GET(new NextRequest('http://localhost/api/customer-pools/pool-1'), { params: Promise.resolve({ id: 'pool-1' }) });
    expect(res.status).toBe(200);
  });
  it('不存在 → 404 POOL_NOT_FOUND', async () => {
    mockPrisma.customerPool = { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn(), update: vi.fn() };
    const res = await GET(new NextRequest('http://localhost/api/customer-pools/pool-x'), { params: Promise.resolve({ id: 'pool-x' }) });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/customer-pools/:id — 乐观锁更新', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    casMock.mockResolvedValue({ outcome: 'OK' });
    mockPrisma.customerPool = {
      findFirst: vi.fn().mockResolvedValue({ ...poolRow, rules: [] }),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    };
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) =>
      fn({ customerPool: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirst: vi.fn().mockResolvedValue({ ...poolRow, name: '新池名' }) } }),
    );
  });

  it('更新名称成功（CAS OK）', async () => {
    const res = await PATCH(makeRequest({ version: 1, name: '新池名' }), { params: Promise.resolve({ id: 'pool-1' }) });
    expect(res.status).toBe(200);
  });

  it('VERSION_CONFLICT → 409', async () => {
    casMock.mockResolvedValue({ outcome: 'CONFLICT' });
    const res = await PATCH(makeRequest({ version: 1, name: '新池名' }), { params: Promise.resolve({ id: 'pool-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('VERSION_CONFLICT');
  });

  it('GLOBAL 池设置 scopeValue → 400 POOL_SCOPE_INVALID', async () => {
    const res = await PATCH(makeRequest({ version: 1, scopeValue: '华东' }), { params: Promise.resolve({ id: 'pool-1' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('POOL_SCOPE_INVALID');
  });
});

describe('DELETE /api/customer-pools/:id — 软删', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.customerPool = {
      findFirst: vi.fn().mockResolvedValue({ ...poolRow }),
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({ id: 'pool-1', deletedAt: new Date() }),
    };
  });
  it('软删成功 + Audit', async () => {
    const res = await DELETE(new NextRequest('http://localhost/api/customer-pools/pool-1', { method: 'DELETE', headers: { authorization: 'Bearer test-token' } }), { params: Promise.resolve({ id: 'pool-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deleted).toBe(true);
    const calls = (await import('@/lib/api-helpers')).writeAuditLog as ReturnType<typeof vi.fn>;
    expect(calls.mock.calls.some((c: unknown[]) => (c[0] as { action: string }).action === 'customer-pool.delete')).toBe(true);
  });
});
