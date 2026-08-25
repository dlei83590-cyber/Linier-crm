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

import { POST, GET } from '@/app/api/suppliers/[id]/settlements/route';

const supplierSettlementMock = () => mockPrisma.supplierSettlement as {
  create: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
};

/**
 * FRT-02 契约测试：SupplierProfile「账期结算」区块依赖的
 * POST/GET /api/suppliers/:id/settlements。
 */
describe('POST /api/suppliers/:id/settlements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.supplier = { findFirst: vi.fn().mockResolvedValue({ id: 'sup-1' }) };
    mockPrisma.supplierSettlement = { create: vi.fn().mockResolvedValue({ id: 's-1', paymentTerms: 'NET30', creditDays: 30, paymentMethod: 'TT' }) };
  });

  it('新增结算条款成功（creditDays 透传）', async () => {
    const req = new NextRequest('http://localhost/api/suppliers/sup-1/settlements', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ paymentTerms: 'NET30', creditDays: 30, paymentMethod: 'TT' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'sup-1' }) });
    expect(res.status).toBe(201);
    const createArgs = supplierSettlementMock().create.mock.calls[0][0];
    expect(createArgs.data.creditDays).toBe(30);
    expect(createArgs.data.supplierId).toBe('sup-1');
  });

  it('creditDays 为负 → 400（校验失败）', async () => {
    const req = new NextRequest('http://localhost/api/suppliers/sup-1/settlements', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ creditDays: -1 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'sup-1' }) });
    expect(res.status).toBe(400);
    expect(supplierSettlementMock().create).not.toHaveBeenCalled();
  });
});

describe('GET /api/suppliers/:id/settlements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.supplier = { findFirst: vi.fn().mockResolvedValue({ id: 'sup-1' }) };
    mockPrisma.supplierSettlement = {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([{ id: 's-1', paymentTerms: 'NET30', creditDays: 30, paymentMethod: 'TT', currency: 'CNY' }]),
    };
  });

  it('返回结算条款列表', async () => {
    const res = await GET(new NextRequest('http://localhost/api/suppliers/sup-1/settlements?pageSize=50'), { params: Promise.resolve({ id: 'sup-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].creditDays).toBe(30);
  });
});
