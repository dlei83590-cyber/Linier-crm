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

import { POST } from '@/app/api/business-partners/[id]/activities/[activityId]/approve/route';

type TxMock = {
  customerActivity: {
    findFirst: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
};

function makeTx(overrides: Partial<TxMock> = {}): TxMock {
  return {
    customerActivity: {
      findFirst: vi.fn().mockResolvedValue({ id: 'act-1', activityType: 'FOLLOW_UP', status: 'SUBMITTED' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    ...overrides,
  };
}

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/business-partners/bp-1/activities/act-1/approve', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
  });
}

function run(tx: TxMock) {
  mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
  return POST(makeRequest(), { params: Promise.resolve({ id: 'bp-1', activityId: 'act-1' }) });
}

describe('POST /api/business-partners/:id/activities/:activityId/approve — 跟进批准（Migration 0051）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SUBMITTED → APPROVED（CAS 写入 approvedAt/approvedById）', async () => {
    const tx = makeTx();
    const res = await run(tx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('APPROVED');
    const updateArgs = (tx.customerActivity.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateArgs.where.status).toBe('SUBMITTED');
    expect(updateArgs.data.status).toBe('APPROVED');
    expect(updateArgs.data.approvedById).toBe('u-1');
    expect(updateArgs.data.approvedAt).toBeInstanceOf(Date);
  });

  it('非 SUBMITTED（如 DRAFT）→ 409 CUSTOMER_ACTIVITY_INVALID_STATE', async () => {
    const tx = makeTx({ customerActivity: { ...makeTx().customerActivity, findFirst: vi.fn().mockResolvedValue({ id: 'act-1', activityType: 'FOLLOW_UP', status: 'DRAFT' }) } });
    const res = await run(tx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CUSTOMER_ACTIVITY_INVALID_STATE');
    expect(tx.customerActivity.updateMany).not.toHaveBeenCalled();
  });

  it('已 APPROVED 重复批准 → 409（CAS 防并发双审批）', async () => {
    const tx = makeTx({ customerActivity: { ...makeTx().customerActivity, updateMany: vi.fn().mockResolvedValue({ count: 0 }), findFirst: vi.fn().mockResolvedValueOnce({ id: 'act-1', activityType: 'FOLLOW_UP', status: 'SUBMITTED' }).mockResolvedValueOnce({ id: 'act-1', status: 'APPROVED' }) } });
    const res = await run(tx);
    expect(res.status).toBe(409);
  });

  it('CHECK_IN 不参与审批 → 409', async () => {
    const tx = makeTx({ customerActivity: { ...makeTx().customerActivity, findFirst: vi.fn().mockResolvedValue({ id: 'act-1', activityType: 'CHECK_IN', status: null }) } });
    const res = await run(tx);
    expect(res.status).toBe(409);
    expect(tx.customerActivity.updateMany).not.toHaveBeenCalled();
  });

  it('活动不存在 → 404', async () => {
    const tx = makeTx({ customerActivity: { ...makeTx().customerActivity, findFirst: vi.fn().mockResolvedValue(null) } });
    const res = await run(tx);
    expect(res.status).toBe(404);
  });
});
