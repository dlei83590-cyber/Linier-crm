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

import { GET, POST } from '@/app/api/business-partners/[id]/activities/[activityId]/comments/route';

const ACT_PARAMS = Promise.resolve({ id: 'bp-1', activityId: 'act-1' });

function getRequest(): NextRequest {
  return new NextRequest('http://localhost/api/business-partners/bp-1/activities/act-1/comments', {
    headers: { authorization: 'Bearer test-token' },
  });
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/business-partners/bp-1/activities/act-1/comments', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

type TxMock = {
  customerActivity: { findFirst: ReturnType<typeof vi.fn> };
  activityComment: { create: ReturnType<typeof vi.fn> };
};

function makeTx(overrides: Partial<TxMock> = {}): TxMock {
  return {
    customerActivity: { findFirst: vi.fn().mockResolvedValue({ id: 'act-1' }) },
    activityComment: {
      create: vi.fn().mockResolvedValue({ id: 'c-1', activityId: 'act-1', content: '已确认', createdById: 'u-1', createdAt: new Date('2026-08-25T00:00:00Z') }),
    },
    ...overrides,
  };
}

describe('GET /api/business-partners/:id/activities/:activityId/comments — 评论列表', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.customerActivity = { findFirst: vi.fn().mockResolvedValue({ id: 'act-1' }) };
    mockPrisma.activityComment = {
      findMany: vi.fn().mockResolvedValue([
        { id: 'c-1', activityId: 'act-1', content: '第一条', createdById: 'u-1', createdAt: new Date('2026-08-25T00:00:00Z') },
      ]),
    };
  });

  it('按 createdAt 升序返回评论', async () => {
    const res = await GET(getRequest(), { params: ACT_PARAMS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].content).toBe('第一条');
    const findArgs = (mockPrisma.activityComment as { findMany: ReturnType<typeof vi.fn> }).findMany.mock.calls[0][0];
    expect(findArgs.orderBy.createdAt).toBe('asc');
  });

  it('活动不存在 → 404', async () => {
    (mockPrisma.customerActivity as { findFirst: ReturnType<typeof vi.fn> }).findFirst.mockResolvedValue(null);
    const res = await GET(getRequest(), { params: ACT_PARAMS });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/business-partners/:id/activities/:activityId/comments — 创建评论', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(makeTx()));
  });

  it('创建评论（content/createdById 落库，201）', async () => {
    const tx = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(postRequest({ content: '请补充预算' }), { params: ACT_PARAMS });
    expect(res.status).toBe(201);
    const createArgs = (tx.activityComment.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArgs.data.content).toBe('请补充预算');
    expect(createArgs.data.createdById).toBe('u-1');
  });

  it('空评论 → 400 VALIDATION_ERROR（create 不被调用）', async () => {
    const tx = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(postRequest({ content: '   ' }), { params: ACT_PARAMS });
    expect(res.status).toBe(400);
    expect(tx.activityComment.create).not.toHaveBeenCalled();
  });

  it('评论超长（>1000）→ 400', async () => {
    const tx = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(postRequest({ content: 'x'.repeat(1001) }), { params: ACT_PARAMS });
    expect(res.status).toBe(400);
    expect(tx.activityComment.create).not.toHaveBeenCalled();
  });

  it('活动不存在 → 404（事务内 fail-closed）', async () => {
    const tx = makeTx({ customerActivity: { findFirst: vi.fn().mockResolvedValue(null) } });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(postRequest({ content: '评论' }), { params: ACT_PARAMS });
    expect(res.status).toBe(404);
    expect(tx.activityComment.create).not.toHaveBeenCalled();
  });
});
