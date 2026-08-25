import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: {} as Record<string, unknown> }));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/api-helpers', () => ({
  authenticate: vi.fn().mockResolvedValue({ id: 'u-1', email: 'a@b.c', roles: ['SUPER_ADMIN'] }),
  requirePermission: vi.fn().mockReturnValue(null),
  requestMeta: vi.fn().mockReturnValue({ requestId: 'req-1' }),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  requestLog: vi.fn(),
}));

import { GET, performancePeriodRange } from '@/app/api/reports/performance/route';

function makeRequest(url: string): NextRequest {
  return new NextRequest(url, { headers: { authorization: 'Bearer test-token' } });
}

describe('performancePeriodRange（Asia/Shanghai 业务日，与经营数据一致）', () => {
  it('month：本月 1 日 00:00 CST 起（from 存 UTC 上月末 16:00）', () => {
    const now = new Date(2026, 7, 15); // 2026-08-15
    const { from, to } = performancePeriodRange('month', now);
    const cst = new Date(from.getTime() + 8 * 60 * 60 * 1000);
    expect(cst.getUTCFullYear()).toBe(2026);
    expect(cst.getUTCMonth()).toBe(7);
    expect(cst.getUTCDate()).toBe(1);
    // to = 下月 1 日 00:00 CST（排他 end），区间 = 1 个月
    const toCst = new Date(to.getTime() + 8 * 60 * 60 * 1000);
    expect(toCst.getUTCMonth()).toBe(8);
    expect(toCst.getUTCDate()).toBe(1);
  });
  it('week：本周一 00:00 CST 起（周日起点偏移 6），跨度 7 天', () => {
    const sunday = new Date(2026, 7, 16); // 2026-08-16 周日（UTC）
    const { from, to } = performancePeriodRange('week', sunday);
    const cst = new Date(from.getTime() + 8 * 60 * 60 * 1000);
    expect(cst.getUTCDate()).toBe(10); // 2026-08-10 周一
    expect(to.getTime() - from.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('GET /api/reports/performance — 按员工聚合客观事实', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user = {
      findMany: vi.fn().mockResolvedValue([
        { id: 'u-1', email: 'a@b.c', name: '张三', department: { name: '销售部' } },
        { id: 'u-2', email: 'd@e.f', name: '李四', department: null },
      ]),
    };
    const groupByEmpty = () => Promise.resolve([]);
    mockPrisma.businessPartner = { groupBy: groupByEmpty };
    mockPrisma.customerActivity = { groupBy: groupByEmpty }; // FOLLOW_UP + CHECK_IN 两次调用
    mockPrisma.projectOpportunity = { groupBy: groupByEmpty };
    mockPrisma.quotation = { groupBy: groupByEmpty };
    mockPrisma.salesOrder = { groupBy: groupByEmpty };
  });

  it('返回每员工统计行（跟进/拜访来自 CustomerActivity）', async () => {
    const res = await GET(makeRequest('http://localhost/api/reports/performance?period=week'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.rows).toHaveLength(2);
    expect(body.data.rows[0].userName).toBe('张三');
    expect(body.data.rows[0].departmentName).toBe('销售部');
    expect(body.data.rows[0].followUpCount).toBe(0); // CustomerActivity.FOLLOW_UP（空 mock）
    expect(body.data.rows[0].visitCount).toBe(0); // CustomerActivity.CHECK_IN
    expect(body.data.dataSources.followUps).toBe(true);
  });

  it('聚合新增客户/拜访/商机/报价/成交订单数', async () => {
    mockPrisma.businessPartner = { groupBy: vi.fn().mockResolvedValue([{ createdById: 'u-1', _count: { _all: 3 } }]) };
    mockPrisma.customerActivity = {
      groupBy: vi.fn(({ where }: { where?: Record<string, unknown> }) => {
        if (where?.activityType === 'CHECK_IN') return Promise.resolve([{ createdById: 'u-1', _count: { _all: 2 } }]);
        return Promise.resolve([{ createdById: 'u-1', _count: { _all: 5 } }]); // FOLLOW_UP
      }),
    };
    mockPrisma.projectOpportunity = { groupBy: vi.fn().mockResolvedValue([{ ownerId: 'u-1', _count: { _all: 1 } }]) };
    mockPrisma.quotation = { groupBy: vi.fn().mockResolvedValue([{ createdById: 'u-1', _count: { _all: 4 } }]) };
    mockPrisma.salesOrder = {
      groupBy: vi.fn().mockResolvedValue([
        { createdById: 'u-1', _count: { _all: 2 }, _sum: { totalAmount: { toString: () => '12345.67' } } },
      ]),
    };
    const res = await GET(makeRequest('http://localhost/api/reports/performance?period=month'));
    const body = await res.json();
    const row = body.data.rows.find((r: { userId: string }) => r.userId === 'u-1');
    expect(row.newCustomerCount).toBe(3);
    expect(row.followUpCount).toBe(5); // CustomerActivity.FOLLOW_UP
    expect(row.visitCount).toBe(2); // CustomerActivity.CHECK_IN
    expect(row.opportunityCount).toBe(1);
    expect(row.quotationCount).toBe(4);
    expect(row.salesOrderCount).toBe(2);
    expect(row.salesAmount).toBe('12345.67');
  });

  it('period 非法 → 400', async () => {
    const res = await GET(makeRequest('http://localhost/api/reports/performance?period=year'));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/reports/performance?view=region — 按 BusinessPartner.region 聚合', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // businessPartner.findMany 区分两次调用：select 含 id = 区域映射；仅 region = 周期内新增客户
    mockPrisma.businessPartner = {
      findMany: vi.fn().mockImplementation((args: { select?: Record<string, boolean> }) => {
        if (args.select && 'id' in args.select) {
          return Promise.resolve([
            { id: 'bp-1', region: '华东' },
            { id: 'bp-2', region: null },
          ]);
        }
        return Promise.resolve([{ region: '华东' }, { region: null }]); // 新增客户：华东 1 + 未设置 1
      }),
      groupBy: vi.fn().mockResolvedValue([]),
    };
    mockPrisma.customerActivity = {
      findMany: vi.fn().mockImplementation((args: { where?: { activityType?: string } }) => {
        if (args.where?.activityType === 'CHECK_IN') {
          return Promise.resolve([{ businessPartnerId: 'bp-1' }]); // 华东 拜访 1
        }
        return Promise.resolve([
          { businessPartnerId: 'bp-1' }, // 华东 跟进 1
          { businessPartnerId: 'bp-2' }, // 未设置 跟进 1
        ]);
      }),
      groupBy: vi.fn().mockResolvedValue([]),
    };
    mockPrisma.projectOpportunity = {
      findMany: vi.fn().mockResolvedValue([{ customerId: 'bp-1' }]), // 华东 商机 1
      groupBy: vi.fn().mockResolvedValue([]),
    };
    mockPrisma.quotation = {
      findMany: vi.fn().mockResolvedValue([{ customerId: 'bp-2' }]), // 未设置 报价 1
      groupBy: vi.fn().mockResolvedValue([]),
    };
    mockPrisma.salesOrder = {
      findMany: vi.fn().mockResolvedValue([
        { customerId: 'bp-1', totalAmount: '100.00' }, // 华东 成交 2 笔 / 金额 150.00
        { customerId: 'bp-1', totalAmount: '50.00' },
      ]),
      groupBy: vi.fn().mockResolvedValue([]),
    };
  });

  it('区域聚合：华东/未设置各维度计数与成交金额（Decimal 求和）', async () => {
    const res = await GET(makeRequest('http://localhost/api/reports/performance?period=week&view=region'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.view).toBe('region');
    expect(body.data.regions).toHaveLength(2);

    const hd = body.data.regions.find((r: { region: string }) => r.region === '华东');
    expect(hd.newCustomerCount).toBe(1);
    expect(hd.followUpCount).toBe(1);
    expect(hd.visitCount).toBe(1);
    expect(hd.opportunityCount).toBe(1);
    expect(hd.quotationCount).toBe(0);
    expect(hd.salesOrderCount).toBe(2);
    expect(hd.salesAmount).toBe(new Prisma.Decimal('100.00').plus('50.00').toString());

    const unset = body.data.regions.find((r: { region: string }) => r.region === '未设置');
    expect(unset.newCustomerCount).toBe(1);
    expect(unset.followUpCount).toBe(1);
    expect(unset.visitCount).toBe(0);
    expect(unset.opportunityCount).toBe(0);
    expect(unset.quotationCount).toBe(1);
    expect(unset.salesOrderCount).toBe(0);
    expect(unset.salesAmount).toBe('0');
  });

  it('区域行按成交订单数降序（华东在前）', async () => {
    const res = await GET(makeRequest('http://localhost/api/reports/performance?period=month&view=region'));
    const body = await res.json();
    expect(body.data.regions[0].region).toBe('华东');
  });

  it('view 非法 → 400', async () => {
    const res = await GET(makeRequest('http://localhost/api/reports/performance?period=week&view=team'));
    expect(res.status).toBe(400);
  });

  it('不传 view 默认 person（回归）', async () => {
    mockPrisma.user = {
      findMany: vi.fn().mockResolvedValue([
        { id: 'u-1', email: 'a@b.c', name: '张三', department: { name: '销售部' } },
      ]),
    };
    const res = await GET(makeRequest('http://localhost/api/reports/performance?period=week'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.view).toBe('person');
    expect(body.data.rows).toHaveLength(1);
    expect(body.data.regions).toBeUndefined();
  });
});
