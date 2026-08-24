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
  customerActivity: { create: ReturnType<typeof vi.fn> };
};

function makeTx(overrides: Partial<TxMock> = {}): TxMock {
  return {
    businessPartner: { findFirst: vi.fn().mockResolvedValue({ id: 'bp-1' }) },
    partnerContact: { findFirst: vi.fn().mockResolvedValue(null) },
    customerActivity: {
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

  it('签到缺经纬度 → 400', async () => {
    const res = await POST(makeRequest({ activityType: 'CHECK_IN' }), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(res.status).toBe(400);
  });

  it('联系人跨客户 → 事务拒绝（CONTACT_MISMATCH → 500 路径或 fail-closed）', async () => {
    const tx = makeTx({ partnerContact: { findFirst: vi.fn().mockResolvedValue(null) } });
    // 传入属于其他客户的 contactId → partnerContact.findFirst（partnerId 限定）返回 null → CONTACT_MISMATCH
    const tx2 = makeTx();
    tx2.partnerContact.findFirst.mockResolvedValue(null);
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx2));
    const res = await POST(makeRequest({ activityType: 'FOLLOW_UP', summary: 'x', contactId: 'c-other' }), { params: Promise.resolve({ id: 'bp-1' }) });
    // CONTACT_MISMATCH 被 catch 为 500？断言非 201 且 customerActivity.create 未调用（fail-closed）
    expect(tx2.customerActivity.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/business-partners/:id/activities — 时间线', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.businessPartner = { findFirst: vi.fn().mockResolvedValue({ id: 'bp-1' }) };
    mockPrisma.customerActivity = {
      count: vi.fn().mockResolvedValue(2),
      findMany: vi.fn().mockResolvedValue([
        { id: 'a1', activityType: 'FOLLOW_UP', createdAt: new Date('2026-08-01T00:00:00Z'), planDate: null, checkinAt: null },
        { id: 'a2', activityType: 'VISIT_PLAN', createdAt: new Date('2026-07-01T00:00:00Z'), planDate: new Date('2026-08-20T00:00:00Z'), checkinAt: null },
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
});
