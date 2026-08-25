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

import { GET, POST } from '@/app/api/customer-supplier-rating-rules/route';

const ratingRuleMock = () =>
  mockPrisma.customerSupplierRatingRule as {
    count: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };

function makeRequest(method: 'GET' | 'POST', url: string, body?: unknown): NextRequest {
  const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers: { authorization: 'Bearer test-token' } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
  }
  return new NextRequest(url, init);
}

describe('GET /api/customer-supplier-rating-rules — 规则列表', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ratingRuleMock().count = vi.fn().mockResolvedValue(1);
    ratingRuleMock().findMany = vi.fn().mockResolvedValue([
      { id: 'r-1', customerLevel: 'VIP', minimumSupplierRating: 'A', isActive: true, version: 1, createdAt: '2026-08-25T00:00:00.000Z' },
    ]);
  });

  it('返回规则列表（分页）', async () => {
    const res = await GET(makeRequest('GET', 'http://localhost/api/customer-supplier-rating-rules?page=1&pageSize=20'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].customerLevel).toBe('VIP');
    expect(body.meta.total).toBe(1);
  });

  it('isActive=false 过滤生效', async () => {
    ratingRuleMock().count = vi.fn().mockResolvedValue(0);
    ratingRuleMock().findMany = vi.fn().mockResolvedValue([]);
    const res = await GET(makeRequest('GET', 'http://localhost/api/customer-supplier-rating-rules?isActive=false'));
    expect(res.status).toBe(200);
    const findArgs = ratingRuleMock().findMany.mock.calls[0][0];
    expect(findArgs.where.isActive).toBe(false);
  });
});

describe('POST /api/customer-supplier-rating-rules — 创建规则', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ratingRuleMock().findUnique = vi.fn().mockResolvedValue(null);
    ratingRuleMock().create = vi.fn().mockResolvedValue({
      id: 'r-1',
      customerLevel: 'KEY',
      minimumSupplierRating: 'AA',
      isActive: true,
      approvalStatus: 'APPROVED',
      version: 1,
    });
  });

  it('创建成功（201）', async () => {
    const res = await POST(makeRequest('POST', 'http://localhost/api/customer-supplier-rating-rules', { customerLevel: 'KEY', minimumSupplierRating: 'AA' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.customerLevel).toBe('KEY');
    const createArgs = ratingRuleMock().create.mock.calls[0][0];
    expect(createArgs.data.minimumSupplierRating).toBe('AA');
    expect(createArgs.data.approvalStatus).toBe('APPROVED');
  });

  it('客户等级重复 → 409（不覆盖已存在规则）', async () => {
    ratingRuleMock().findUnique = vi.fn().mockResolvedValue({ id: 'r-1', customerLevel: 'KEY', deletedAt: null });
    const res = await POST(makeRequest('POST', 'http://localhost/api/customer-supplier-rating-rules', { customerLevel: 'KEY', minimumSupplierRating: 'A' }));
    expect(res.status).toBe(409);
    expect(ratingRuleMock().create).not.toHaveBeenCalled();
  });

  it('非法枚举值 → 400', async () => {
    const res = await POST(makeRequest('POST', 'http://localhost/api/customer-supplier-rating-rules', { customerLevel: 'SILVER', minimumSupplierRating: 'A' }));
    expect(res.status).toBe(400);
  });
});
