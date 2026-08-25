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

import { POST } from '@/app/api/business-partners/[id]/activities/[activityId]/checkout/route';

type TxMock = {
  customerActivity: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

function makeTx(activity: Record<string, unknown> | null): TxMock {
  return {
    customerActivity: {
      findFirst: vi.fn().mockResolvedValue(activity),
      update: vi.fn().mockResolvedValue({ id: 'ck-1', checkinAt: new Date('2026-09-02T05:00:00Z'), checkoutAt: new Date() }),
    },
  };
}

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/business-partners/bp-1/activities/ck-1/checkout', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
  });
}

describe('POST /api/business-partners/:id/activities/:activityId/checkout — 签退（Migration 0051）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('签退成功：checkoutAt 服务端 now 落库', async () => {
    const tx = makeTx({ id: 'ck-1', businessPartnerId: 'bp-1', activityType: 'CHECK_IN', checkinAt: new Date('2026-09-02T05:00:00Z'), checkoutAt: null });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const before = Date.now();
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'bp-1', activityId: 'ck-1' }) });
    expect(res.status).toBe(200);
    const updateArgs = (tx.customerActivity.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateArgs.data.checkoutAt).toBeInstanceOf(Date);
    expect((updateArgs.data.checkoutAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect(updateArgs.where.id).toBe('ck-1');
  });

  it('已签退 → 409 CHECK_IN_ALREADY_CHECKED_OUT（update 不被调用）', async () => {
    const tx = makeTx({ id: 'ck-1', businessPartnerId: 'bp-1', activityType: 'CHECK_IN', checkinAt: new Date('2026-09-02T05:00:00Z'), checkoutAt: new Date('2026-09-02T06:00:00Z') });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'bp-1', activityId: 'ck-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CHECK_IN_ALREADY_CHECKED_OUT');
    expect(tx.customerActivity.update).not.toHaveBeenCalled();
  });

  it('签到记录不存在 → 404', async () => {
    const tx = makeTx(null);
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'bp-1', activityId: 'missing' }) });
    expect(res.status).toBe(404);
    expect(tx.customerActivity.update).not.toHaveBeenCalled();
  });

  it('非 CHECK_IN 活动 → 400 校验失败（仅签到可签退）', async () => {
    const tx = makeTx({ id: 'vp-1', businessPartnerId: 'bp-1', activityType: 'VISIT_PLAN', planDate: new Date(), checkinAt: null, checkoutAt: null });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'bp-1', activityId: 'vp-1' }) });
    expect(res.status).toBe(400);
    expect(tx.customerActivity.update).not.toHaveBeenCalled();
  });
});
