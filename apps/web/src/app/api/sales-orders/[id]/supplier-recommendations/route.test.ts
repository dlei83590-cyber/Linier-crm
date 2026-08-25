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

import { GET } from '@/app/api/sales-orders/[id]/supplier-recommendations/route';

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/sales-orders/so-1/supplier-recommendations', { headers: { authorization: 'Bearer test-token' } });
}

describe('GET /api/sales-orders/:id/supplier-recommendations — 推荐供应商（Q 线）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.salesOrder = { findFirst: vi.fn().mockResolvedValue({ id: 'so-1', customerId: 'c-1' }) };
    mockPrisma.salesOrderLine = {
      findMany: vi.fn().mockResolvedValue([{ itemId: 'fg-1' }, { itemId: 'fg-2' }]),
    };
    mockPrisma.supplierItem = {
      findMany: vi.fn().mockResolvedValue([
        { id: 'si-1', itemId: 'fg-1', isPreferred: true, purchasePrice: '100', supplier: { id: 'sup-1', code: 'S001', name: '甲供应商', creditRating: 'A', settlementTerms: '30 天', isActive: true } },
        { id: 'si-2', itemId: 'fg-2', isPreferred: false, purchasePrice: '200', supplier: { id: 'sup-1', code: 'S001', name: '甲供应商', creditRating: 'A', settlementTerms: '30 天', isActive: true } },
        { id: 'si-3', itemId: 'fg-1', isPreferred: false, purchasePrice: '90', supplier: { id: 'sup-2', code: 'S002', name: '乙供应商', creditRating: 'B', settlementTerms: null, isActive: true } },
      ]),
    };
  });

  it('按供应商聚合：优选优先 + 覆盖商品数', async () => {
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'so-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(2);
    expect(body.data[0].supplierName).toBe('甲供应商'); // 优选优先
    expect(body.data[0].itemCount).toBe(2);
    expect(body.data[0].preferredCount).toBe(1);
  });

  it('无 SupplierItem → 空数组', async () => {
    mockPrisma.supplierItem = { findMany: vi.fn().mockResolvedValue([]) };
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'so-1' }) });
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  it('订单不存在 → 404', async () => {
    mockPrisma.salesOrder = { findFirst: vi.fn().mockResolvedValue(null) };
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'so-x' }) });
    expect(res.status).toBe(404);
  });
});
