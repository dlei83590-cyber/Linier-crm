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

import { POST, GET } from '@/app/api/business-partners/[id]/products/route';
import { DELETE } from '@/app/api/business-partners/[id]/products/[productId]/route';

type TxMock = {
  businessPartner: { findFirst: ReturnType<typeof vi.fn> };
  item: { findFirst: ReturnType<typeof vi.fn> };
  customerProduct: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
};

function makeTx(overrides: Partial<TxMock> = {}): TxMock {
  return {
    businessPartner: { findFirst: vi.fn().mockResolvedValue({ id: 'bp-1', type: 'CUSTOMER' }) },
    item: { findFirst: vi.fn().mockResolvedValue({ id: 'it-1' }) },
    customerProduct: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'cp-1', businessPartnerId: 'bp-1', itemId: 'it-1' }),
    },
    ...overrides,
  };
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/business-partners/bp-1/products', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/business-partners/:id/products — 客户档案多产品', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(makeTx()));
  });

  it('新增客户产品关联 → 201', async () => {
    const res = await POST(makeRequest({ itemId: 'it-1', note: '主力型号' }), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(res.status).toBe(201);
  });

  it('缺 itemId → 400 VALIDATION_ERROR', async () => {
    const res = await POST(makeRequest({ note: 'x' }), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(res.status).toBe(400);
  });

  it('产品（物料）不存在 → 404，create 不被调用', async () => {
    const tx = makeTx();
    tx.item.findFirst.mockResolvedValue(null);
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest({ itemId: 'it-missing' }), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(res.status).toBe(404);
    expect(tx.customerProduct.create).not.toHaveBeenCalled();
  });

  it('重复关联 → 409 CONFLICT', async () => {
    const tx = makeTx();
    tx.customerProduct.findFirst.mockResolvedValue({ id: 'cp-existing' });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest({ itemId: 'it-1' }), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(res.status).toBe(409);
    expect(tx.customerProduct.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/business-partners/:id/products — 列表', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.businessPartner = { findFirst: vi.fn().mockResolvedValue({ id: 'bp-1' }) };
    mockPrisma.customerProduct = {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([
        { id: 'cp-1', item: { id: 'it-1', code: 'ITEM-1', name: '电机' } },
      ]),
    };
  });

  it('返回客户产品列表', async () => {
    const res = await GET(new NextRequest('http://localhost/api/business-partners/bp-1/products'), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].item.name).toBe('电机');
    expect(body.meta.total).toBe(1);
  });
});

describe('DELETE /api/business-partners/:id/products/:productId — 解除关联', () => {
  const cp = () => mockPrisma.customerProduct as { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.customerProduct = {
      findFirst: vi.fn().mockResolvedValue({ id: 'cp-1', itemId: 'it-1' }),
      update: vi.fn().mockResolvedValue({ id: 'cp-1' }),
    };
  });

  it('软删除成功（deletedAt 落库）', async () => {
    const res = await DELETE(new NextRequest('http://localhost/api/business-partners/bp-1/products/cp-1', { method: 'DELETE', headers: { authorization: 'Bearer test-token' } }), { params: Promise.resolve({ id: 'bp-1', productId: 'cp-1' }) });
    expect(res.status).toBe(200);
    const updateArgs = cp().update.mock.calls[0][0];
    expect(updateArgs.data.deletedAt).toBeInstanceOf(Date);
    expect(updateArgs.data.isActive).toBe(false);
  });

  it('关联不存在（或不属于该客户）→ 404', async () => {
    cp().findFirst.mockResolvedValue(null);
    const res = await DELETE(new NextRequest('http://localhost/api/business-partners/bp-1/products/cp-x', { method: 'DELETE', headers: { authorization: 'Bearer test-token' } }), { params: Promise.resolve({ id: 'bp-1', productId: 'cp-x' }) });
    expect(res.status).toBe(404);
    expect(cp().update).not.toHaveBeenCalled();
  });
});
