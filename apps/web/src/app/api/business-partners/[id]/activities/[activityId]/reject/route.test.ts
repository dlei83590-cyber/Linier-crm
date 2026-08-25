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

import { POST } from '@/app/api/business-partners/[id]/activities/[activityId]/reject/route';

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

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/business-partners/bp-1/activities/act-1/reject', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function run(tx: TxMock, body: unknown) {
  mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
  return POST(makeRequest(body), { params: Promise.resolve({ id: 'bp-1', activityId: 'act-1' }) });
}

describe('POST /api/business-partners/:id/activities/:activityId/reject — 跟进驳回（Migration 0051）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SUBMITTED → REJECTED（rejectReason 必填并落库）', async () => {
    const tx = makeTx();
    const res = await run(tx, { rejectReason: '缺少客户预算确认' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('REJECTED');
    expect(body.data.rejectReason).toBe('缺少客户预算确认');
    const updateArgs = (tx.customerActivity.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateArgs.where.status).toBe('SUBMITTED');
    expect(updateArgs.data.status).toBe('REJECTED');
    expect(updateArgs.data.rejectedById).toBe('u-1');
    expect(updateArgs.data.rejectReason).toBe('缺少客户预算确认');
  });

  it('缺驳回原因 → 400 VALIDATION_ERROR', async () => {
    const tx = makeTx();
    const res = await run(tx, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(tx.customerActivity.updateMany).not.toHaveBeenCalled();
  });

  it('驳回原因超长（>500）→ 400', async () => {
    const tx = makeTx();
    const res = await run(tx, { rejectReason: 'x'.repeat(501) });
    expect(res.status).toBe(400);
    expect(tx.customerActivity.updateMany).not.toHaveBeenCalled();
  });

  it('非 SUBMITTED（如 APPROVED）→ 409', async () => {
    const tx = makeTx({ customerActivity: { ...makeTx().customerActivity, findFirst: vi.fn().mockResolvedValue({ id: 'act-1', activityType: 'FOLLOW_UP', status: 'APPROVED' }) } });
    const res = await run(tx, { rejectReason: '理由' });
    expect(res.status).toBe(409);
    expect(tx.customerActivity.updateMany).not.toHaveBeenCalled();
  });

  it('活动不存在 → 404', async () => {
    const tx = makeTx({ customerActivity: { ...makeTx().customerActivity, findFirst: vi.fn().mockResolvedValue(null) } });
    const res = await run(tx, { rejectReason: '理由' });
    expect(res.status).toBe(404);
  });
});
