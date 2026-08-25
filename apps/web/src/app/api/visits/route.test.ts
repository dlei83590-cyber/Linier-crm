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

import { GET } from '@/app/api/visits/route';

/** 访问 mockPrisma 的受控类型（对齐既有测试模式：bracket access + cast，禁止 unknown dot access） */
type CustomerActivityMock = {
  count: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
};
function customerActivityMock(): CustomerActivityMock {
  return mockPrisma['customerActivity'] as CustomerActivityMock;
}

const PLAN = (overrides: Record<string, unknown> = {}) => ({
  id: 'plan-1',
  activityType: 'VISIT_PLAN',
  businessPartnerId: 'bp-1',
  contactId: null,
  contact: null,
  planDate: new Date('2026-09-02T04:00:00.000Z'),
  summary: '季度回访',
  createdById: 'u-1',
  createdAt: new Date('2026-08-20T00:00:00.000Z'),
  businessPartner: {
    id: 'bp-1', code: 'C001', name: '示例客户', type: 'CUSTOMER',
    address: null, region: null, latitude: null, longitude: null, allowedRadiusMeters: null,
  },
  ...overrides,
});

const CHECKIN = (overrides: Record<string, unknown> = {}) => ({
  id: 'ck-1',
  visitPlanId: 'plan-1',
  checkinAt: new Date('2026-09-02T05:00:00.000Z'),
  checkoutAt: null,
  latitude: '31.23',
  longitude: '121.47',
  locationNote: '客户现场',
  createdById: 'u-2',
  ...overrides,
});

describe('GET /api/visits — 拜访周/月视图（Migration 0051）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('本周视图：返回 VISIT_PLAN 并派生状态（有签到 → COMPLETED；无 → PENDING）+ 负责人名称映射', async () => {
    mockPrisma['customerActivity'] = {
      count: vi.fn().mockResolvedValue(2),
      findMany: vi
        .fn()
        .mockResolvedValueOnce([
          PLAN(),
          PLAN({ id: 'plan-2', businessPartnerId: 'bp-2', businessPartner: { id: 'bp-2', code: 'C002', name: '第二客户', type: 'CUSTOMER', address: null, region: null, latitude: null, longitude: null, allowedRadiusMeters: null } }),
        ])
        .mockResolvedValueOnce([CHECKIN()]),
    };
    mockPrisma['user'] = { findMany: vi.fn().mockResolvedValue([{ id: 'u-1', name: '张三', email: 'z@b.c' }]) };

    const res = await GET(new NextRequest('http://localhost/api/visits?range=week'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(2);
    const completed = body.data.find((r: { id: string }) => r.id === 'plan-1');
    const pending = body.data.find((r: { id: string }) => r.id === 'plan-2');
    expect(completed.status).toBe('COMPLETED');
    expect(completed.checkins[0].checkinAt).toBeTruthy();
    expect(completed.owner.name).toBe('张三');
    expect(pending.status).toBe('PENDING');
    expect(pending.checkins.length).toBe(0);
  });

  it('周视图范围：planDate 过滤 gte 周一 00:00 / lt 下周一 00:00（北京时间）', async () => {
    mockPrisma['customerActivity'] = {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValueOnce([PLAN()]).mockResolvedValueOnce([]),
    };
    mockPrisma['user'] = { findMany: vi.fn().mockResolvedValue([]) };

    await GET(new NextRequest('http://localhost/api/visits?range=week'));
    const where = customerActivityMock().findMany.mock.calls[0][0].where;
    expect(where.activityType).toBe('VISIT_PLAN');
    expect(where.planDate.gte).toBeInstanceOf(Date);
    expect(where.planDate.lt).toBeInstanceOf(Date);
    expect(where.planDate.lt.getTime() - where.planDate.gte.getTime()).toBe(7 * 24 * 3600 * 1000);
  });

  it('月视图范围：planDate 过滤 1 号 00:00 / 下月 1 号 00:00（北京时间）', async () => {
    mockPrisma['customerActivity'] = {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValueOnce([PLAN()]).mockResolvedValueOnce([]),
    };
    mockPrisma['user'] = { findMany: vi.fn().mockResolvedValue([]) };

    await GET(new NextRequest('http://localhost/api/visits?range=month'));
    const where = customerActivityMock().findMany.mock.calls[0][0].where;
    // 回加 8h 得到北京时间自然日（CN 1 号 00:00 = UTC 上月最后一天 16:00）
    expect(new Date(where.planDate.gte.getTime() + 8 * 3600 * 1000).getUTCDate()).toBe(1);
    expect(new Date(where.planDate.lt.getTime() + 8 * 3600 * 1000).getUTCDate()).toBe(1);
    // 下月 1 号 - 本月 1 号（月长 28~31 天）
    const days = (where.planDate.lt.getTime() - where.planDate.gte.getTime()) / (24 * 3600 * 1000);
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(31);
  });

  it('ownerId 筛选透传；按 planDate 升序排序', async () => {
    mockPrisma['customerActivity'] = {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValueOnce([PLAN()]).mockResolvedValueOnce([]),
    };
    mockPrisma['user'] = { findMany: vi.fn().mockResolvedValue([]) };

    await GET(new NextRequest('http://localhost/api/visits?range=week&ownerId=u-9'));
    const where = customerActivityMock().findMany.mock.calls[0][0].where;
    expect(where.createdById).toBe('u-9');
    const orderBy = customerActivityMock().findMany.mock.calls[0][0].orderBy;
    expect(orderBy[0].planDate).toBe('asc');
  });
});
