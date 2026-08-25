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

import { POST, GET } from '@/app/api/suppliers/[id]/credit/route';

const partnerCreditMock = () => mockPrisma.partnerCredit as {
  findFirst: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
};

/**
 * FRT-02 契约测试：SupplierProfile「信用评级」区块依赖的
 * POST/GET /api/suppliers/:id/credit（PartnerCredit upsert，共享信用 1:1）。
 */
function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/suppliers/sup-1/credit', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/suppliers/:id/credit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.supplier = { findFirst: vi.fn().mockResolvedValue({ id: 'sup-1', partnerId: 'bp-1' }) };
  });

  it('无信用记录 → upsert create（201），partnerId 绑定供应商主体', async () => {
    mockPrisma.partnerCredit = {
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: 'pc-1', partnerId: 'bp-1', rating: 'A', status: 'NORMAL' }),
    };
    const res = await POST(makeReq({ rating: 'A', status: 'NORMAL', creditLimit: 100000 }), { params: Promise.resolve({ id: 'sup-1' }) });
    expect(res.status).toBe(201);
    const upsertArgs = partnerCreditMock().upsert.mock.calls[0][0];
    expect(upsertArgs.where.partnerId).toBe('bp-1');
    expect(upsertArgs.create.rating).toBe('A');
  });

  it('已有信用记录 + version 不匹配 → 409 VERSION_CONFLICT（前端提示刷新重试）', async () => {
    mockPrisma.partnerCredit = {
      findFirst: vi.fn().mockResolvedValue({ id: 'pc-1', partnerId: 'bp-1', version: 3 }),
      upsert: vi.fn(),
    };
    const res = await POST(makeReq({ rating: 'AA', version: 2 }), { params: Promise.resolve({ id: 'sup-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('VERSION_CONFLICT');
    expect(partnerCreditMock().upsert).not.toHaveBeenCalled();
  });

  it('非法 rating → 400（校验失败）', async () => {
    mockPrisma.partnerCredit = { findFirst: vi.fn().mockResolvedValue(null), upsert: vi.fn() };
    const res = await POST(makeReq({ rating: 'Z' }), { params: Promise.resolve({ id: 'sup-1' }) });
    expect(res.status).toBe(400);
    expect(partnerCreditMock().upsert).not.toHaveBeenCalled();
  });
});

describe('GET /api/suppliers/:id/credit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.supplier = { findFirst: vi.fn().mockResolvedValue({ id: 'sup-1', partnerId: 'bp-1' }) };
    mockPrisma.partnerCredit = { findFirst: vi.fn().mockResolvedValue({ id: 'pc-1', rating: 'A', status: 'NORMAL', creditLimit: '100000' }) };
  });

  it('返回 PartnerCredit（含 rating/status/creditLimit）', async () => {
    const res = await GET(new NextRequest('http://localhost/api/suppliers/sup-1/credit'), { params: Promise.resolve({ id: 'sup-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.rating).toBe('A');
    expect(body.data.creditLimit).toBe('100000');
  });
});
