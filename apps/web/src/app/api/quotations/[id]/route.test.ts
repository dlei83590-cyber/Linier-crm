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

import { GET } from '@/app/api/quotations/[id]/route';

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/quotations/qt-1', { headers: { authorization: 'Bearer test-token' } });
}

const baseQuotation = {
  id: 'qt-1',
  code: 'QT-2026-0001',
  customerId: 'c-1',
  status: 'ACCEPTED',
  quoteDate: new Date('2026-01-01T00:00:00.000Z'),
  validUntil: null,
  currency: 'CNY',
  subtotal: '100',
  taxAmount: '13',
  totalAmount: '113',
  remark: null,
  salesOrderId: null,
  convertedAt: null,
  isActive: true,
  createdById: null,
  updatedById: null,
  approvedById: null,
  approvalStatus: 'APPROVED',
  version: 1,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('GET /api/quotations/:id — FRT-06 已转订单链接投影', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.quotation = { findFirst: vi.fn().mockResolvedValue(null) };
  });

  it('未转换：salesOrder 为 null，前端不展示转换链接', async () => {
    mockPrisma.quotation = {
      findFirst: vi.fn().mockResolvedValue({ ...baseQuotation, salesOrder: null }),
    };
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'qt-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe('qt-1');
    expect(body.data.salesOrder).toBeNull();
  });

  it('已转换：GET 详情携带 salesOrder 投影（id/code/status），报价详情可直链销售订单', async () => {
    mockPrisma.quotation = {
      findFirst: vi.fn().mockResolvedValue({
        ...baseQuotation,
        salesOrderId: 'so-1',
        convertedAt: new Date('2026-01-02T00:00:00.000Z'),
        salesOrder: { id: 'so-1', code: 'SO-2026-0001', status: 'DRAFT' },
      }),
    };
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'qt-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.salesOrderId).toBe('so-1');
    expect(body.data.salesOrder).toEqual({ id: 'so-1', code: 'SO-2026-0001', status: 'DRAFT' });
    // 断言 prisma include 携带 salesOrder 投影（防止回归删除）
    const findFirst = (mockPrisma.quotation as { findFirst: ReturnType<typeof vi.fn> }).findFirst;
    const include = findFirst.mock.calls[0][0] as { include: { salesOrder: unknown } };
    expect(include.salesOrder).toEqual({ select: { id: true, code: true, status: true } });
  });

  it('报价单不存在 → 404', async () => {
    mockPrisma.quotation = { findFirst: vi.fn().mockResolvedValue(null) };
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'qt-x' }) });
    expect(res.status).toBe(404);
  });
});
