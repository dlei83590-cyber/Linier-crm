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

import { GET } from '@/app/api/project-opportunities/[id]/route';

const DAY = 86_400_000;

type OppModel = { findFirst: ReturnType<typeof vi.fn> };
type ActivityModel = { findFirst: ReturnType<typeof vi.fn> };

let oppModel: OppModel;
let activityModel: ActivityModel;

function makeOpp() {
  return {
    id: 'o1',
    code: 'OP-001',
    name: '机会一',
    customerId: 'bp-1',
    stage: 'QUALIFIED',
    expectedRevenue: null,
    successProbability: null,
    paymentStatus: 'UNPAID',
    createdAt: new Date(Date.now() - 30 * DAY),
    customer: { id: 'bp-1', code: 'BP-1', name: '客户一', type: 'CUSTOMER' },
    project: null,
    quotations: [],
  };
}

function detailUrl() {
  return new NextRequest('http://localhost/api/project-opportunities/o1');
}

describe('GET /api/project-opportunities/:id — 商机跟进 MVP（详情显示最近跟进时间 + 距今 N 天）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    oppModel = { findFirst: vi.fn().mockResolvedValue(makeOpp()) };
    activityModel = { findFirst: vi.fn() };
    mockPrisma.projectOpportunity = oppModel;
    mockPrisma.customerActivity = activityModel;
  });

  it('有跟进记录：返回最近跟进时间（该商机关联客户最近一条 FOLLOW_UP）+ 距今 N 天', async () => {
    const lastFollowUp = new Date(Date.now() - 3 * DAY);
    activityModel.findFirst.mockResolvedValue({ createdAt: lastFollowUp });

    const res = await GET(detailUrl(), { params: Promise.resolve({ id: 'o1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.lastFollowUpAt).toBe(lastFollowUp.toISOString());
    expect(body.data.daysSinceFollowUp).toBe(3);
    expect(body.data.needsFollowUp).toBe(false);
    expect(body.data.followUpThresholdDays).toBe(7);
    // 查询限定：该商机客户 + FOLLOW_UP + 未删除，取最新一条
    const whereArg = activityModel.findFirst.mock.calls[0][0];
    expect(whereArg.where).toMatchObject({
      businessPartnerId: 'bp-1',
      activityType: 'FOLLOW_UP',
      deletedAt: null,
    });
    expect(whereArg.orderBy.createdAt).toBe('desc');
  });

  it('从未跟进：lastFollowUpAt=null，daysSinceFollowUp=null；商机创建超阈值 → 待跟进', async () => {
    activityModel.findFirst.mockResolvedValue(null);

    const res = await GET(detailUrl(), { params: Promise.resolve({ id: 'o1' }) });
    const body = await res.json();
    expect(body.data.lastFollowUpAt).toBeNull();
    expect(body.data.daysSinceFollowUp).toBeNull();
    expect(body.data.needsFollowUp).toBe(true);
  });
});
