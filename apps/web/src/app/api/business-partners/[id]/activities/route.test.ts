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

import { POST, GET } from '@/app/api/business-partners/[id]/activities/route';

type TxMock = {
  businessPartner: { findFirst: ReturnType<typeof vi.fn> };
  partnerContact: { findFirst: ReturnType<typeof vi.fn> };
  customerActivity: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
};

function makeTx(overrides: Partial<TxMock> = {}): TxMock {
  return {
    businessPartner: { findFirst: vi.fn().mockResolvedValue({ id: 'bp-1' }) },
    partnerContact: { findFirst: vi.fn().mockResolvedValue(null) },
    customerActivity: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'act-1', activityType: 'FOLLOW_UP', businessPartnerId: 'bp-1' }),
    },
    ...overrides,
  };
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/business-partners/bp-1/activities', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/business-partners/:id/activities — Phase 3 MVP 跟进活动', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(makeTx()));
  });

  it('创建客户跟进（summary 必填）', async () => {
    const res = await POST(makeRequest({ activityType: 'FOLLOW_UP', summary: '确认样品需求', nextAction: '下周报价' }), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(res.status).toBe(201);
  });

  it('跟进缺 summary → 400 VALIDATION_ERROR', async () => {
    const res = await POST(makeRequest({ activityType: 'FOLLOW_UP' }), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(res.status).toBe(400);
  });

  it('拜访计划必填 planDate', async () => {
    const res = await POST(makeRequest({ activityType: 'VISIT_PLAN' }), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(res.status).toBe(400);
    const ok = await POST(makeRequest({ activityType: 'VISIT_PLAN', planDate: '2026-09-01T00:00:00.000Z', summary: '季度回访' }), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(ok.status).toBe(201);
  });

  it('签到：checkinAt 服务端 now 落库（不信任客户端时间）+ 经纬度', async () => {
    const tx = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const before = Date.now();
    const res = await POST(makeRequest({ activityType: 'CHECK_IN', latitude: 31.23, longitude: 121.47, locationNote: '客户现场' }), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(res.status).toBe(201);
    const createArgs = (tx.customerActivity.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArgs.data.checkinAt).toBeInstanceOf(Date);
    expect(createArgs.data.checkinAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(createArgs.data.latitude?.toString()).toBe('31.23');
  });

  it('跟进创建：status=DRAFT（进入审批流）；拜访/签到 status=NULL（不参与审批，Migration 0051）', async () => {
    const tx = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    await POST(makeRequest({ activityType: 'FOLLOW_UP', summary: '确认交期' }), { params: Promise.resolve({ id: 'bp-1' }) });
    expect((tx.customerActivity.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.status).toBe('DRAFT');

    const tx2 = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx2));
    await POST(makeRequest({ activityType: 'VISIT_PLAN', planDate: '2026-09-01T00:00:00.000Z' }), { params: Promise.resolve({ id: 'bp-1' }) });
    expect((tx2.customerActivity.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.status).toBeNull();
  });

  it('签到缺经纬度 → 400', async () => {
    const res = await POST(makeRequest({ activityType: 'CHECK_IN' }), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(res.status).toBe(400);
  });

  it('签到关联 visitPlanId：计划须属本客户且为 VISIT_PLAN → 201 + 自动生成 FOLLOW_UP 草稿「签到：时间/位置」', async () => {
    const tx = makeTx();
    tx.customerActivity.findFirst.mockResolvedValue({ id: 'vp-1', activityType: 'VISIT_PLAN' });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(
      makeRequest({ activityType: 'CHECK_IN', latitude: 31.23, longitude: 121.47, visitPlanId: 'vp-1', locationNote: '客户现场' }),
      { params: Promise.resolve({ id: 'bp-1' }) },
    );
    expect(res.status).toBe(201);
    const calls = (tx.customerActivity.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(2); // CHECK_IN + 自动 FOLLOW_UP
    // 第一条 = CHECK_IN（携带 visitPlanId）
    expect(calls[0][0].data.activityType).toBe('CHECK_IN');
    expect(calls[0][0].data.visitPlanId).toBe('vp-1');
    // 第二条 = 自动 FOLLOW_UP 草稿
    expect(calls[1][0].data.activityType).toBe('FOLLOW_UP');
    expect(calls[1][0].data.summary.startsWith('签到：')).toBe(true);
    expect(calls[1][0].data.summary).toContain('客户现场');
  });

  it('签到关联 visitPlanId 指向不存在/跨客户计划 → 400（create 不被调用）', async () => {
    const tx = makeTx();
    tx.customerActivity.findFirst.mockResolvedValue(null); // 本客户 VISIT_PLAN 无命中
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(
      makeRequest({ activityType: 'CHECK_IN', latitude: 31.23, longitude: 121.47, visitPlanId: 'vp-other' }),
      { params: Promise.resolve({ id: 'bp-1' }) },
    );
    expect(res.status).toBe(400);
    expect(tx.customerActivity.create).not.toHaveBeenCalled();
  });

  it('签到范围：超出客户 allowedRadiusMeters → 400 CHECK_IN_OUT_OF_RANGE（明确提示，create 不被调用）', async () => {
    const tx = makeTx();
    tx.businessPartner.findFirst.mockResolvedValue({ id: 'bp-1', latitude: '31.23', longitude: '121.47', allowedRadiusMeters: 100 });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    // 北京（39.90, 116.40）距上海客户约 1000+ km → 超范围
    const res = await POST(
      makeRequest({ activityType: 'CHECK_IN', latitude: 39.9, longitude: 116.4 }),
      { params: Promise.resolve({ id: 'bp-1' }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('CHECK_IN_OUT_OF_RANGE');
    expect(body.error.details.distanceMeters).toBeGreaterThan(100);
    expect(tx.customerActivity.create).not.toHaveBeenCalled();
  });

  it('签到范围：在允许半径内 → 201（服务端距离 ≤ radius 放行）', async () => {
    const tx = makeTx();
    tx.businessPartner.findFirst.mockResolvedValue({ id: 'bp-1', latitude: '31.23', longitude: '121.47', allowedRadiusMeters: 500 });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    // 距客户约 15 米 → 范围内
    const res = await POST(
      makeRequest({ activityType: 'CHECK_IN', latitude: 31.2301, longitude: 121.4701 }),
      { params: Promise.resolve({ id: 'bp-1' }) },
    );
    expect(res.status).toBe(201);
    expect(tx.customerActivity.create).toHaveBeenCalledTimes(2);
  });

  it('联系人跨客户 → 事务拒绝（fail-closed：create 不被调用）', async () => {
    const tx2 = makeTx();
    tx2.partnerContact.findFirst.mockResolvedValue(null); // partnerId 限定查询无命中 → CONTACT_MISMATCH
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx2));
    await POST(makeRequest({ activityType: 'FOLLOW_UP', summary: 'x', contactId: 'c-other' }), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(tx2.customerActivity.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/business-partners/:id/activities — 时间线', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.businessPartner = { findFirst: vi.fn().mockResolvedValue({ id: 'bp-1' }) };
    // FE 2.0 操作人只读投影：user 摘要查询
    mockPrisma.user = { findMany: vi.fn().mockResolvedValue([{ id: 'u-2', name: '审批人', email: 'p@x.c' }]) };
    mockPrisma.customerActivity = {
      count: vi.fn().mockResolvedValue(2),
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'a1', activityType: 'FOLLOW_UP', createdAt: new Date('2026-08-01T00:00:00Z'), planDate: null, checkinAt: null,
          status: 'APPROVED', submittedAt: null, approvedAt: new Date('2026-08-02T00:00:00Z'), approvedById: 'u-2',
          rejectedAt: null, rejectedById: null, rejectReason: null,
          _count: { comments: 2 },
        },
        {
          id: 'a2', activityType: 'VISIT_PLAN', createdAt: new Date('2026-07-01T00:00:00Z'), planDate: new Date('2026-08-20T00:00:00Z'), checkinAt: null,
          status: null, submittedAt: null, approvedAt: null, approvedById: null,
          rejectedAt: null, rejectedById: null, rejectReason: null,
          _count: { comments: 0 },
        },
      ]),
    };
  });

  it('返回时间线（VISIT_PLAN 按 planDate 排序）', async () => {
    const res = await GET(new NextRequest('http://localhost/api/business-partners/bp-1/activities'), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].id).toBe('a2'); // planDate 更晚 → 排前
    expect(body.data[0].occurredAt).toBeTruthy();
  });

  it('时间线返回跟进审批状态 + 评论数（Migration 0051）', async () => {
    const res = await GET(new NextRequest('http://localhost/api/business-partners/bp-1/activities'), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    const followUp = body.data.find((a: { id: string }) => a.id === 'a1');
    expect(followUp.status).toBe('APPROVED');
    expect(followUp.approvedById).toBe('u-2');
    expect(followUp.commentCount).toBe(2);
    const visitPlan = body.data.find((a: { id: string }) => a.id === 'a2');
    expect(visitPlan.status).toBeNull(); // VISIT_PLAN 不参与审批
    expect(visitPlan.commentCount).toBe(0);
  });
});
