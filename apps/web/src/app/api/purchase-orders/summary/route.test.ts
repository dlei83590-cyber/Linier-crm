import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: {} as Record<string, unknown> }));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/api-helpers', () => ({
  authenticate: vi.fn().mockResolvedValue({ id: 'u-1', email: 'a@b.c', roles: ['SUPER_ADMIN'] }),
  requirePermission: vi.fn().mockReturnValue(null),
  requestLog: vi.fn(),
}));

import { GET } from '@/app/api/purchase-orders/summary/route';

/**
 * 模块页仪表盘 KPI：GET /api/purchase-orders/summary 路由级测试
 * 覆盖：total / byStatus 状态计数 / amount Decimal 字符串返回（禁止 toNumber）
 */

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/purchase-orders/summary', {
    headers: { authorization: 'Bearer test-token' },
  });
}

describe('GET /api/purchase-orders/summary — 页面仪表盘 KPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('返回 total + 按状态计数 + 金额（Decimal 字符串）', async () => {
    mockPrisma.purchaseOrder = {
      count: vi.fn().mockResolvedValue(12),
      groupBy: vi.fn().mockResolvedValue([
        { status: 'DRAFT', _count: { _all: 3 } },
        { status: 'CONFIRMED', _count: { _all: 9 } },
      ]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { totalAmount: new Prisma.Decimal('12345.6700') } }),
    };

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.total).toBe(12);
    expect(body.data.byStatus).toEqual({ DRAFT: 3, CONFIRMED: 9 });
    expect(body.data.amount).toEqual({ label: '订单金额', value: '12345.67' });
  });

  it('金额为 0 时返回 undefined（无金额卡）', async () => {
    mockPrisma.purchaseOrder = {
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { totalAmount: null } }),
    };

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.data.total).toBe(0);
    expect(body.data.byStatus).toEqual({});
    expect(body.data.amount).toBeUndefined();
  });

  it('未授权返回 403', async () => {
    const { requirePermission } = await import('@/lib/api-helpers');
    (requirePermission as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Response(JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } }), { status: 403 }),
    );
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
  });
});
