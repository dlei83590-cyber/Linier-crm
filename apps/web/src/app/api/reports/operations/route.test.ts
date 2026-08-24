import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: {} as Record<string, unknown> }));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/api-helpers', () => ({
  authenticate: vi.fn().mockResolvedValue({ id: 'u-1', email: 'a@b.c', roles: ['SUPER_ADMIN'] }),
  requirePermission: vi.fn().mockReturnValue(null),
  requestMeta: vi.fn().mockReturnValue({ requestId: 'req-1' }),
  requestLog: vi.fn(),
}));

import { GET } from '@/app/api/reports/operations/route';

function makeRequest(period?: string): NextRequest {
  const url = period ? `http://localhost/api/reports/operations?period=${period}` : 'http://localhost/api/reports/operations';
  return new NextRequest(url, { headers: { authorization: 'Bearer test-token' } });
}

type MockAgg = { _sum: { totalAmount: { toString: () => string } | null } };

function buildMocks() {
  mockPrisma['salesOrder'] = {
    count: vi.fn().mockResolvedValue(3),
    aggregate: vi.fn().mockResolvedValue({ _sum: { totalAmount: { toString: () => '12000.50' } } } as MockAgg),
    groupBy: vi.fn().mockResolvedValue([
      { status: 'DRAFT', _count: { _all: 1 } },
      { status: 'CONFIRMED', _count: { _all: 2 } },
    ]),
  };
  mockPrisma['quotation'] = {
    count: vi.fn().mockResolvedValue(5),
    aggregate: vi.fn().mockResolvedValue({ _sum: { totalAmount: { toString: () => '88000.00' } } } as MockAgg),
  };
  mockPrisma['businessPartner'] = {
    count: vi.fn().mockResolvedValue(10),
  };
  mockPrisma['projectOpportunity'] = {
    count: vi.fn().mockResolvedValue(6),
    groupBy: vi.fn().mockResolvedValue([
      { stage: 'LEAD', _count: { _all: 2 } },
      { stage: 'QUOTATION', _count: { _all: 4 } },
    ]),
  };
  mockPrisma['projectVisit'] = {
    count: vi.fn().mockResolvedValue(7),
  };
}

describe('GET /api/reports/operations — 经营数据固定看板（只读聚合）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildMocks();
  });

  it('默认 period=month → 200，返回全部指标且金额为 Decimal 字符串', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const d = body.data;
    expect(d.period).toBe('month');
    expect(d.salesOrders.count).toBe(3);
    expect(d.salesOrders.amount).toBe('12000.50');
    expect(d.salesOrders.byStatus).toEqual({ DRAFT: 1, CONFIRMED: 2 });
    expect(d.quotations.count).toBe(5);
    expect(d.quotations.amount).toBe('88000.00');
    expect(d.customers).toEqual({ total: 10, newInPeriod: 10 });
    expect(d.opportunities.total).toBe(6);
    expect(d.opportunities.funnel).toEqual({ LEAD: 2, QUOTATION: 4 });
    expect(d.visits).toEqual({ visits: 7, followUps: 7 });
    expect(d.range.from).toBeTruthy();
    expect(d.range.to).toBeTruthy();
  });

  it('订单/报价 KPI 排除 CANCELLED，且按 createdAt 区间过滤（groupBy 保留全状态构成）', async () => {
    await GET(makeRequest('month'));
    const soCount = mockPrisma['salesOrder'] as { count: ReturnType<typeof vi.fn>; aggregate: ReturnType<typeof vi.fn>; groupBy: ReturnType<typeof vi.fn> };
    const soCountWhere = soCount.count.mock.calls[0][0].where as { status?: { not?: string }; createdAt?: { gte?: Date; lt?: Date } };
    expect(soCountWhere.status?.not).toBe('CANCELLED');
    expect(soCountWhere.createdAt?.gte).toBeInstanceOf(Date);
    expect(soCountWhere.createdAt?.lt).toBeInstanceOf(Date);
    const soAggWhere = soCount.aggregate.mock.calls[0][0].where as { status?: { not?: string } };
    expect(soAggWhere.status?.not).toBe('CANCELLED');
    // 状态构成 groupBy 不排除 CANCELLED（透明展示口径）
    const soGroupWhere = soCount.groupBy.mock.calls[0][0].where as { status?: unknown };
    expect(soGroupWhere.status).toBeUndefined();
    const qt = mockPrisma['quotation'] as { aggregate: ReturnType<typeof vi.fn> };
    const qtAggWhere = qt.aggregate.mock.calls[0][0].where as { status?: { not?: string } };
    expect(qtAggWhere.status?.not).toBe('CANCELLED');
  });

  it('period=day → Asia/Shanghai 业务日边界（UTC 16:00 起，跨度 24h）', async () => {
    const res = await GET(makeRequest('day'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const from = new Date(body.data.range.from);
    const to = new Date(body.data.range.to);
    expect(from.getUTCHours()).toBe(16); // 00:00 CST = 前一日 16:00 UTC
    expect(to.getTime() - from.getTime()).toBe(24 * 60 * 60 * 1000);
    const so = mockPrisma['salesOrder'] as { count: ReturnType<typeof vi.fn> };
    const where = so.count.mock.calls[0][0].where as { createdAt?: { gte?: Date; lt?: Date } };
    expect(where.createdAt?.gte?.getTime()).toBe(from.getTime());
    expect(where.createdAt?.lt?.getTime()).toBe(to.getTime());
  });

  it('period=year → 当年 1 月 1 日 00:00 CST 起', async () => {
    const res = await GET(makeRequest('year'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const from = new Date(body.data.range.from);
    // start 以 UTC 存 12/31 16:00（= CST 1/1 00:00）；用 CST 视角断言业务日
    const cst = new Date(from.getTime() + 8 * 60 * 60 * 1000);
    expect(cst.getUTCMonth()).toBe(0);
    expect(cst.getUTCDate()).toBe(1);
    expect(from.getUTCHours()).toBe(16);
  });

  it('非法 period → 400 VALIDATION_ERROR（不触达 DB）', async () => {
    const res = await GET(makeRequest('week'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect((mockPrisma['salesOrder'] as { count: ReturnType<typeof vi.fn> }).count).not.toHaveBeenCalled();
  });

  it('无 reports:view 权限 → 403（requirePermission 拒绝，不触达 DB）', async () => {
    const helpers = await import('@/lib/api-helpers');
    (helpers.requirePermission as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: '无权限' } }, { status: 403 }),
    );
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
    expect((mockPrisma['salesOrder'] as { count: ReturnType<typeof vi.fn> }).count).not.toHaveBeenCalled();
  });
});
