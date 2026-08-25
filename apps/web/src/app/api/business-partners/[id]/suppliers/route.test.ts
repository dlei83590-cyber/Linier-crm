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

import { POST, GET } from '@/app/api/business-partners/[id]/suppliers/route';
import { DELETE } from '@/app/api/business-partners/[id]/suppliers/[relationId]/route';

type TxMock = {
  businessPartner: { findFirst: ReturnType<typeof vi.fn> };
  customerSupplier: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
};

function makeTx(overrides: Partial<TxMock> = {}): TxMock {
  return {
    businessPartner: { findFirst: vi.fn().mockResolvedValue({ id: 'bp-1', type: 'CUSTOMER' }) },
    customerSupplier: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'cs-1', customerId: 'bp-1', supplierId: 'sup-1' }),
    },
    ...overrides,
  };
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/business-partners/bp-1/suppliers', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/business-partners/:id/suppliers — 客户档案多供应商', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(makeTx()));
  });

  it('新增客户供应商关联（supplier type=SUPPLIER）→ 201', async () => {
    // businessPartner.findFirst 被调用两次：先客户(id=bp-1)，后供应商(id=sup-1)
    const tx = makeTx();
    tx.businessPartner.findFirst
      .mockResolvedValueOnce({ id: 'bp-1', type: 'CUSTOMER' })
      .mockResolvedValueOnce({ id: 'sup-1', type: 'SUPPLIER' });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest({ supplierId: 'sup-1', note: '主供' }), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(res.status).toBe(201);
    const createArgs = (tx.customerSupplier.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArgs.data.customerId).toBe('bp-1');
    expect(createArgs.data.supplierId).toBe('sup-1');
  });

  it('自关联拒绝 → 400，create 不被调用', async () => {
    const tx = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest({ supplierId: 'bp-1' }), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(res.status).toBe(400);
    expect(tx.customerSupplier.create).not.toHaveBeenCalled();
  });

  it('所选往来单位不是供应商（type=CUSTOMER）→ 400', async () => {
    const tx = makeTx();
    tx.businessPartner.findFirst
      .mockResolvedValueOnce({ id: 'bp-1', type: 'CUSTOMER' })
      .mockResolvedValueOnce({ id: 'sup-2', type: 'CUSTOMER' });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest({ supplierId: 'sup-2' }), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(res.status).toBe(400);
    expect(tx.customerSupplier.create).not.toHaveBeenCalled();
  });

  it('重复关联 → 409 CONFLICT', async () => {
    const tx = makeTx();
    tx.customerSupplier.findFirst.mockResolvedValue({ id: 'cs-existing' });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest({ supplierId: 'sup-1' }), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(res.status).toBe(409);
    expect(tx.customerSupplier.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/business-partners/:id/suppliers — 列表', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.businessPartner = { findFirst: vi.fn().mockResolvedValue({ id: 'bp-1' }) };
    mockPrisma.customerSupplier = {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([
        { id: 'cs-1', supplier: { id: 'sup-1', code: 'SUP-001', name: '上海电机厂', type: 'SUPPLIER' } },
      ]),
    };
  });

  it('返回客户供应商列表（含供应商往来单位）', async () => {
    const res = await GET(new NextRequest('http://localhost/api/business-partners/bp-1/suppliers'), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].supplier.name).toBe('上海电机厂');
    expect(body.meta.total).toBe(1);
  });
});

describe('DELETE /api/business-partners/:id/suppliers/:relationId — 解除关联', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.customerSupplier = {
      findFirst: vi.fn().mockResolvedValue({ id: 'cs-1', supplierId: 'sup-1' }),
      update: vi.fn().mockResolvedValue({ id: 'cs-1' }),
    };
  });

  it('软删除成功', async () => {
    const res = await DELETE(new NextRequest('http://localhost/api/business-partners/bp-1/suppliers/cs-1', { method: 'DELETE', headers: { authorization: 'Bearer test-token' } }), { params: Promise.resolve({ id: 'bp-1', relationId: 'cs-1' }) });
    expect(res.status).toBe(200);
    const updateArgs = (mockPrisma.customerSupplier.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateArgs.data.deletedAt).toBeInstanceOf(Date);
  });

  it('关联不存在（或不属于该客户）→ 404', async () => {
    mockPrisma.customerSupplier.findFirst.mockResolvedValue(null);
    const res = await DELETE(new NextRequest('http://localhost/api/business-partners/bp-1/suppliers/cs-x', { method: 'DELETE', headers: { authorization: 'Bearer test-token' } }), { params: Promise.resolve({ id: 'bp-1', relationId: 'cs-x' }) });
    expect(res.status).toBe(404);
    expect(mockPrisma.customerSupplier.update).not.toHaveBeenCalled();
  });
});
