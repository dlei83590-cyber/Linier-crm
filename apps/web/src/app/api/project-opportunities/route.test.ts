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

import { GET } from '@/app/api/project-opportunities/route';

const DAY = 86_400_000;

type OppModel = { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
type ActivityModel = { findMany: ReturnType<typeof vi.fn> };

let oppModel: OppModel;
let activityModel: ActivityModel;

function makeOpp(id: string, customerId: string, createdAt: Date) {
  return {
    id,
    code: 'OP-' + id,
    name: '机会 ' + id,
    customerId,
    stage: 'LEAD',
    expectedRevenue: null,
    successProbability: null,
    paymentStatus: 'UNPAID',
    createdAt,
    customer: { id: customerId, code: 'BP-' + customerId, name: '客户 ' + customerId, type: 'CUSTOMER' },
    project: null,
  };
}

function listUrl() {
  return new NextRequest('http://localhost/api/project-opportunities?page=1&pageSize=20');
}

describe('GET /api/project-opportunities — 商机跟进 MVP（最近跟进时间 + 待跟进标记）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    oppModel = { count: vi.fn().mockResolvedValue(1), findMany: vi.fn() };
    activityModel = { findMany: vi.fn().mockResolvedValue([]) };
    mockPrisma.projectOpportunity = oppModel;
    mockPrisma.customerActivity = activityModel;
  });

  it('阈值内最近跟进：返回最近跟进时间 + 距今天数，needsFollowUp=false', async () => {
    const lastFollowUp = new Date(Date.now() - 2 * DAY);
    oppModel.findMany.mockResolvedValue([makeOpp('o1', 'bp-1', new Date(Date.now() - 30 * DAY))]);
    activityModel.findMany.mockResolvedValue([{ businessPartnerId: 'bp-1', createdAt: lastFollowUp }]);

    const res = await GET(listUrl());
    expect(res.status).toBe(200);
    const body = await res.json();
    const row = body.data[0];
    expect(row.lastFollowUpAt).toBe(lastFollowUp.toISOString());
    expect(row.daysSinceFollowUp).toBe(2);
    expect(row.needsFollowUp).toBe(false);
    expect(row.followUpThresholdDays).toBe(7);
  });

  it('跟进超过 7 天 → needsFollowUp=true（待跟进标记）', async () => {
    const lastFollowUp = new Date(Date.now() - 10 * DAY);
    oppModel.findMany.mockResolvedValue([makeOpp('o1', 'bp-1', new Date(Date.now() - 30 * DAY))]);
    activityModel.findMany.mockResolvedValue([{ businessPartnerId: 'bp-1', createdAt: lastFollowUp }]);

    const res = await GET(listUrl());
    const body = await res.json();
    const row = body.data[0];
    expect(row.daysSinceFollowUp).toBe(10);
    expect(row.needsFollowUp).toBe(true);
  });

  it('从未跟进但商机创建已超阈值 → needsFollowUp=true（基线退化为 createdAt），lastFollowUpAt=null', async () => {
    oppModel.findMany.mockResolvedValue([makeOpp('o1', 'bp-1', new Date(Date.now() - 30 * DAY))]);
    activityModel.findMany.mockResolvedValue([]);

    const res = await GET(listUrl());
    const body = await res.json();
    const row = body.data[0];
    expect(row.lastFollowUpAt).toBeNull();
    expect(row.daysSinceFollowUp).toBeNull();
    expect(row.needsFollowUp).toBe(true);
  });

  it('多商机：各客户最近跟进正确归属（客户 A 的跟进不泄漏给客户 B 的商机）', async () => {
    const aOld = new Date(Date.now() - 20 * DAY);
    const bRecent = new Date(Date.now() - 1 * DAY);
    oppModel.findMany.mockResolvedValue([
      makeOpp('oA', 'bp-a', new Date(Date.now() - 60 * DAY)),
      makeOpp('oB', 'bp-b', new Date(Date.now() - 5 * DAY)),
    ]);
    // orderBy createdAt desc 语义：最近的排前；每客户取首条即最新
    activityModel.findMany.mockResolvedValue([
      { businessPartnerId: 'bp-b', createdAt: bRecent },
      { businessPartnerId: 'bp-a', createdAt: aOld },
    ]);

    const res = await GET(listUrl());
    const body = await res.json();
    const rows = (body.data ?? []) as Array<{
      id: string;
      needsFollowUp: boolean;
      daysSinceFollowUp: number | null;
    }>;
    const rowA = rows.find((r) => r.id === 'oA');
    const rowB = rows.find((r) => r.id === 'oB');
    expect(rowA?.needsFollowUp).toBe(true);
    expect(rowA?.daysSinceFollowUp).toBe(20);
    expect(rowB?.needsFollowUp).toBe(false);
    expect(rowB?.daysSinceFollowUp).toBe(1);
    // 查询按本页商机客户集合过滤（in 条件），非全量
    const whereArg = activityModel.findMany.mock.calls[0][0];
    expect(whereArg.where.businessPartnerId.in).toEqual(['bp-a', 'bp-b']);
  });
});