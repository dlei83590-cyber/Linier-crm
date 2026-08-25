import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

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

/** 默认 mocks：全部业务事实为空（无目标/无分层/无区域） */
function buildMocks() {
  mockPrisma['salesOrder'] = {
    count: vi.fn().mockResolvedValue(3),
    aggregate: vi.fn().mockResolvedValue({ _sum: { totalAmount: { toString: () => '12000.50' } } } as MockAgg),
    groupBy: vi.fn().mockResolvedValue([
      { status: 'DRAFT', _count: { _all: 1 } },
      { status: 'CONFIRMED', _count: { _all: 2 } },
    ]),
    // 第一次调用=客户分层（distinct）；第二次调用=区域订单
    findMany: vi.fn().mockResolvedValue([]),
  };
  mockPrisma['quotation'] = {
    count: vi.fn().mockResolvedValue(5),
    aggregate: vi.fn().mockResolvedValue({ _sum: { totalAmount: { toString: () => '88000.00' } } } as MockAgg),
    findMany: vi.fn().mockResolvedValue([]),
  };
  mockPrisma['businessPartner'] = {
    count: vi.fn().mockResolvedValue(10),
    groupBy: vi.fn().mockResolvedValue([]),
    findMany: vi.fn().mockResolvedValue([]),
  };
  mockPrisma['projectOpportunity'] = {
    count: vi.fn().mockResolvedValue(6),
    groupBy: vi.fn().mockResolvedValue([
      { stage: 'LEAD', _count: { _all: 2 } },
      { stage: 'QUOTATION', _count: { _all: 4 } },
    ]),
    findMany: vi.fn().mockResolvedValue([]),
  };
  mockPrisma['customerActivity'] = {
    count: vi.fn().mockResolvedValue(7),
  };
  mockPrisma['reportTarget'] = {
    findMany: vi.fn().mockResolvedValue([]),
  };
  // brand 维度（CTO ⑦）：SalesOrderLine → Item.brand
  mockPrisma['salesOrderLine'] = {
    findMany: vi.fn().mockResolvedValue([]),
  };
  mockPrisma['item'] = {
    findMany: vi.fn().mockResolvedValue([]),
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
    // 无目标/无分层事实/无区域 → 空默认
    expect(d.targets).toEqual([]);
    expect(d.customerTiers).toEqual({ total: 10, deal: 0, quoted: 0, opportunity: 0, normal: 10 });
    expect(d.regions).toEqual([]);
  });

  it('订单/报价 KPI 排除 CANCELLED，且按 createdAt 区间过滤（groupBy 保留全状态构成）', async () => {
    await GET(makeRequest('month'));
    const soCount = mockPrisma['salesOrder'] as { count: ReturnType<typeof vi.fn>; aggregate: ReturnType<typeof vi.fn>; groupBy: ReturnType<typeof vi.fn> };
    const soCountWhere = soCount.count.mock.calls[0][0].where as { status?: { notIn?: string[] }; createdAt?: { gte?: Date; lt?: Date } };
    expect(soCountWhere.status?.notIn).toEqual(['DRAFT', 'CANCELLED']);
    expect(soCountWhere.createdAt?.gte).toBeInstanceOf(Date);
    expect(soCountWhere.createdAt?.lt).toBeInstanceOf(Date);
    const soAggWhere = soCount.aggregate.mock.calls[0][0].where as { status?: { notIn?: string[] } };
    expect(soAggWhere.status?.notIn).toEqual(['DRAFT', 'CANCELLED']);
    const soGroupWhere = soCount.groupBy.mock.calls[0][0].where as { status?: unknown };
    expect(soGroupWhere.status).toBeUndefined();
    const qt = mockPrisma['quotation'] as { aggregate: ReturnType<typeof vi.fn> };
    const qtAggWhere = qt.aggregate.mock.calls[0][0].where as { status?: { not?: string } };
    expect(qtAggWhere.status?.not).toBe('CANCELLED');
  });

  it('客户分层事实计算：有成交 > 有报价未成交 > 有商机无报价 > 普通客户（非 AI）', async () => {
    const so = mockPrisma['salesOrder'] as { findMany: ReturnType<typeof vi.fn> };
    const qt = mockPrisma['quotation'] as { findMany: ReturnType<typeof vi.fn> };
    const opp = mockPrisma['projectOpportunity'] as { findMany: ReturnType<typeof vi.fn> };
    // 成交客户 bp-1/bp-2；报价客户 bp-1/bp-2/bp-3；商机客户 bp-2/bp-3/bp-4/bp-5
    so.findMany.mockResolvedValueOnce([{ customerId: 'bp-1' }, { customerId: 'bp-2' }]); // 分层（distinct）
    qt.findMany.mockResolvedValueOnce([{ customerId: 'bp-1' }, { customerId: 'bp-2' }, { customerId: 'bp-3' }]);
    opp.findMany.mockResolvedValueOnce([{ customerId: 'bp-2' }, { customerId: 'bp-3' }, { customerId: 'bp-4' }, { customerId: 'bp-5' }]);
    const res = await GET(makeRequest('month'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const t = body.data.customerTiers;
    expect(t).toEqual({ total: 10, deal: 2, quoted: 1, opportunity: 2, normal: 5 });
    // 分层查询不得按期间过滤（点态快照全史）
    const tierWhere = so.findMany.mock.calls[0][0].where;
    expect(tierWhere.deletedAt).toBeNull();
    expect(tierWhere.createdAt).toBeUndefined();
  });

  it('目标达成率：ReportTarget 静态目标 × 本期实际（rate=actual/target×100%，1 位小数）', async () => {
    const rt = mockPrisma['reportTarget'] as { findMany: ReturnType<typeof vi.fn> };
    rt.findMany.mockResolvedValue([
      { id: 't1', dimensionType: 'SALES_AMOUNT', dimensionValue: 'ALL', targetAmount: { toString: () => '20000.00' }, isActive: true },
      { id: 't2', dimensionType: 'NEW_CUSTOMERS', dimensionValue: 'ALL', targetAmount: { toString: () => '20' }, isActive: true },
    ]);
    const res = await GET(makeRequest('month'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const targets = body.data.targets;
    expect(targets).toHaveLength(2);
    const sales = targets.find((t: { dimensionType: string }) => t.dimensionType === 'SALES_AMOUNT');
    expect(sales.targetAmount).toBe('20000.00');
    expect(sales.actual).toBe('12000.50');
    expect(sales.rate).toBe(60.0); // 12000.50/20000×100 = 60.0
    const newC = targets.find((t: { dimensionType: string }) => t.dimensionType === 'NEW_CUSTOMERS');
    expect(newC.actual).toBe('10');
    expect(newC.rate).toBe(50.0);
    // period 键 = 当前月（YYYY-MM）
    expect(rt.findMany.mock.calls[0][0].where.period).toMatch(/^\d{4}-\d{2}$/);
    expect(rt.findMany.mock.calls[0][0].where.dimensionValue).toBe('ALL');
  });

  it('固定区域维度：BusinessPartner.region 聚合客户数 + 期间订单数/金额（未设置归「未设置」）', async () => {
    const bp = mockPrisma['businessPartner'] as { groupBy: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
    const so = mockPrisma['salesOrder'] as { findMany: ReturnType<typeof vi.fn> };
    bp.groupBy.mockResolvedValue([
      { region: '华东', _count: { _all: 5 } },
      { region: '华南', _count: { _all: 5 } },
    ]);
    so.findMany
      .mockResolvedValueOnce([]) // 分层（无成交）
      .mockResolvedValueOnce([
        { customerId: 'bp-1', totalAmount: new Prisma.Decimal('8000.00') },
        { customerId: 'bp-9', totalAmount: new Prisma.Decimal('4000.00') },
      ]);
    bp.findMany.mockResolvedValue([
      { id: 'bp-1', region: '华东' },
      { id: 'bp-9', region: null },
    ]);
    const res = await GET(makeRequest('month'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const regions = body.data.regions;
    const east = regions.find((r: { region: string }) => r.region === '华东');
    // Decimal.toString() 会去掉尾随零（8000.00 → '8000'），与仓库金额字符串口径一致
    expect(east).toEqual({ region: '华东', customerCount: 5, salesOrderCount: 1, salesAmount: '8000' });
    const unset = regions.find((r: { region: string }) => r.region === '未设置');
    expect(unset).toEqual({ region: '未设置', customerCount: 0, salesOrderCount: 1, salesAmount: '4000' });
  });

  it('period=day → Asia/Shanghai 业务日边界（UTC 16:00 起，跨度 24h）', async () => {
    const res = await GET(makeRequest('day'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const from = new Date(body.data.range.from);
    const to = new Date(body.data.range.to);
    expect(from.getUTCHours()).toBe(16);
    expect(to.getTime() - from.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('period=year → 当年 1 月 1 日 00:00 CST 起', async () => {
    const res = await GET(makeRequest('year'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const from = new Date(body.data.range.from);
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
