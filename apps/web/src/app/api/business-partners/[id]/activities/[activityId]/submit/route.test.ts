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

import { POST } from '@/app/api/business-partners/[id]/activities/[activityId]/submit/route';

type TxMock = {
  customerActivity: {
    findFirst: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
};

function makeTx(overrides: Partial<TxMock> = {}): TxMock {
  return {
    customerActivity: {
      findFirst: vi.fn().mockResolvedValue({ id: 'act-1', activityType: 'FOLLOW_UP', status: 'DRAFT' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    ...overrides,
  };
}

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/business-partners/bp-1/activities/act-1/submit', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
  });
}

function run(tx: TxMock) {
  mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
  return POST(makeRequest(), { params: Promise.resolve({ id: 'bp-1', activityId: 'act-1' }) });
}

describe('POST /api/business-partners/:id/activities/:activityId/submit — 跟进提交审批（Migration 0051）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DRAFT → SUBMITTED（CAS 写入 submittedAt/submittedById）', async () => {
    const tx = makeTx();
    const res = await run(tx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('SUBMITTED');
    const updateArgs = (tx.customerActivity.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateArgs.where.status).toEqual({ in: ['DRAFT', 'REJECTED'] });
    expect(updateArgs.data.status).toBe('SUBMITTED');
    expect(updateArgs.data.submittedById).toBe('u-1');
    expect(updateArgs.data.submittedAt).toBeInstanceOf(Date);
  });

  it('REJECTED → SUBMITTED（重新提交清除驳回事实）', async () => {
    const tx = makeTx({ customerActivity: { ...makeTx().customerActivity, findFirst: vi.fn().mockResolvedValue({ id: 'act-1', activityType: 'FOLLOW_UP', status: 'REJECTED' }) } });
    const res = await run(tx);
    expect(res.status).toBe(200);
    const updateArgs = (tx.customerActivity.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateArgs.data.rejectReason).toBeNull();
    expect(updateArgs.data.rejectedById).toBeNull();
  });

  it('非 DRAFT/REJECTED（如 APPROVED）→ 409 CUSTOMER_ACTIVITY_INVALID_STATE', async () => {
    const tx = makeTx({ customerActivity: { ...makeTx().customerActivity, findFirst: vi.fn().mockResolvedValue({ id: 'act-1', activityType: 'FOLLOW_UP', status: 'APPROVED' }) } });
    const res = await run(tx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CUSTOMER_ACTIVITY_INVALID_STATE');
    expect(tx.customerActivity.updateMany).not.toHaveBeenCalled();
  });

  it('VISIT_PLAN 不参与审批 → 409（updateMany 不被调用）', async () => {
    const tx = makeTx({ customerActivity: { ...makeTx().customerActivity, findFirst: vi.fn().mockResolvedValue({ id: 'act-1', activityType: 'VISIT_PLAN', status: null }) } });
    const res = await run(tx);
    expect(res.status).toBe(409);
    expect(tx.customerActivity.updateMany).not.toHaveBeenCalled();
  });

  it('活动不存在 → 404 CUSTOMER_ACTIVITY_NOT_FOUND', async () => {
    const tx = makeTx({ customerActivity: { ...makeTx().customerActivity, findFirst: vi.fn().mockResolvedValue(null) } });
    const res = await run(tx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('CUSTOMER_ACTIVITY_NOT_FOUND');
  });

  it('CAS 并发冲突（updateMany 0 行）→ 409', async () => {
    const tx = makeTx({ customerActivity: { ...makeTx().customerActivity, updateMany: vi.fn().mockResolvedValue({ count: 0 }), findFirst: vi.fn().mockResolvedValueOnce({ id: 'act-1', activityType: 'FOLLOW_UP', status: 'DRAFT' }).mockResolvedValueOnce({ id: 'act-1', status: 'SUBMITTED' }) } });
    const res = await run(tx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CUSTOMER_ACTIVITY_INVALID_STATE');
  });
});
