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

import { GET, PATCH, DELETE } from '@/app/api/customer-supplier-rating-rules/[id]/route';
import { casUpdate } from '@/lib/api/cas';

const casMock = casUpdate as ReturnType<typeof vi.fn>;

const ratingRuleMock = () =>
  mockPrisma.customerSupplierRatingRule as {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };

function makeRequest(method: 'GET' | 'PATCH' | 'DELETE', url: string, body?: unknown): NextRequest {
  const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers: { authorization: 'Bearer test-token' } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
  }
  return new NextRequest(url, init);
}

describe('GET /api/customer-supplier-rating-rules/:id — 规则详情', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ratingRuleMock().findFirst = vi.fn();
  });

  it('返回规则详情', async () => {
    ratingRuleMock().findFirst = vi.fn().mockResolvedValue({ id: 'r-1', customerLevel: 'VIP', minimumSupplierRating: 'A', isActive: true, version: 1 });
    const res = await GET(makeRequest('GET', 'http://localhost/api/customer-supplier-rating-rules/r-1'), { params: Promise.resolve({ id: 'r-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.customerLevel).toBe('VIP');
  });

  it('不存在 → 404', async () => {
    ratingRuleMock().findFirst = vi.fn().mockResolvedValue(null);
    const res = await GET(makeRequest('GET', 'http://localhost/api/customer-supplier-rating-rules/r-x'), { params: Promise.resolve({ id: 'r-x' }) });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/customer-supplier-rating-rules/:id — 更新规则（乐观锁）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ratingRuleMock().findFirst = vi.fn().mockResolvedValue({ id: 'r-1', customerLevel: 'VIP', minimumSupplierRating: 'A', isActive: true, version: 1 });
    casMock.mockResolvedValue({ outcome: 'OK' });
  });

  it('更新 minimumSupplierRating 成功', async () => {
    const res = await PATCH(makeRequest('PATCH', 'http://localhost/api/customer-supplier-rating-rules/r-1', { minimumSupplierRating: 'AA', isActive: true, version: 1 }), { params: Promise.resolve({ id: 'r-1' }) });
    expect(res.status).toBe(200);
    const casArgs = casMock.mock.calls[0];
    expect(casArgs[1]).toBe('customerSupplierRatingRule');
    expect(casArgs[3]).toBe(1);
    expect(casArgs[4].minimumSupplierRating).toBe('AA');
  });

  it('版本冲突 → 409', async () => {
    casMock.mockResolvedValue({ outcome: 'CONFLICT' });
    const res = await PATCH(makeRequest('PATCH', 'http://localhost/api/customer-supplier-rating-rules/r-1', { minimumSupplierRating: 'AA', version: 2 }), { params: Promise.resolve({ id: 'r-1' }) });
    expect(res.status).toBe(409);
  });

  it('规则不存在 → 404', async () => {
    ratingRuleMock().findFirst = vi.fn().mockResolvedValue(null);
    const res = await PATCH(makeRequest('PATCH', 'http://localhost/api/customer-supplier-rating-rules/r-x', { minimumSupplierRating: 'AA', version: 1 }), { params: Promise.resolve({ id: 'r-x' }) });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/customer-supplier-rating-rules/:id — 软删除', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ratingRuleMock().findFirst = vi.fn().mockResolvedValue({ id: 'r-1', customerLevel: 'VIP', minimumSupplierRating: 'A', isActive: true, version: 1 });
    ratingRuleMock().update = vi.fn().mockResolvedValue({ id: 'r-1' });
  });

  it('软删除成功（deletedAt + isActive=false）', async () => {
    const res = await DELETE(makeRequest('DELETE', 'http://localhost/api/customer-supplier-rating-rules/r-1'), { params: Promise.resolve({ id: 'r-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deleted).toBe(true);
    const updateArgs = ratingRuleMock().update.mock.calls[0][0];
    expect(updateArgs.data.isActive).toBe(false);
    expect(updateArgs.data.deletedAt).toBeInstanceOf(Date);
  });
});
