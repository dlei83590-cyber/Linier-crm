import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { mockPrisma, mockRequirePermission } = vi.hoisted(() => ({
  mockPrisma: {} as Record<string, unknown>,
  mockRequirePermission: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/api-helpers', () => ({
  authenticate: vi.fn().mockResolvedValue({ id: 'u-1', email: 'a@b.c', roles: ['SUPER_ADMIN'] }),
  requirePermission: mockRequirePermission,
  requestMeta: vi.fn().mockReturnValue({ requestId: 'req-1' }),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  requestLog: vi.fn(),
}));

import { POST } from '@/app/api/project-opportunities/[id]/convert/route';

type TxMock = {
  $queryRaw: ReturnType<typeof vi.fn>;
  projectOpportunity: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  documentSequence: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  project: { create: ReturnType<typeof vi.fn> };
};

function makeTx(overrides: Partial<TxMock> = {}): TxMock {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'opp-1' }]),
    projectOpportunity: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'opp-1',
        name: '机会 A',
        customerId: 'bp-1',
        stage: 'LEAD',
        convertedAt: null,
        project: null,
        description: null,
        competitors: null,
        customerInvestment: null,
        expectedRevenue: null,
        expectedCost: null,
        grossProfit: null,
        expenseBudget: null,
        salesTarget: null,
        paymentStatus: 'UNPAID',
        successProbability: null,
        ownerId: null,
      }),
      update: vi.fn().mockResolvedValue({ id: 'opp-1', convertedAt: new Date(), convertedBy: 'u-1' }),
    },
    documentSequence: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    project: {
      create: vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({ id: 'proj-1', code: data.code, name: data.name }),
      ),
    },
    ...overrides,
  };
}

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/project-opportunities/opp-1/convert', {
    method: 'POST',
    headers: { authorization: 'Bearer t' },
  });
}

describe('POST /api/project-opportunities/:id/convert — 商机→项目唯一转换入口（FRT-05）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockReturnValue(null);
    mockPrisma.$transaction = vi.fn();
  });

  it('未转换机会 → 创建 Project（复制客户/财务/描述）+ 回写 convertedAt/convertedBy，返回真实 project.id', async () => {
    const tx = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'opp-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.converted).toBe(true);
    expect(body.data.project.id).toBe('proj-1');
    // Project 创建复制机会事实（零前端推导）
    const createArgs = (tx.project.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArgs.data.name).toBe('机会 A');
    expect(createArgs.data.customerId).toBe('bp-1');
    expect(createArgs.data.opportunityId).toBe('opp-1');
    expect(createArgs.data.stage).toBe('SAMPLING');
    // 回写 Opportunity
    const updateArgs = (tx.projectOpportunity.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateArgs.where.id).toBe('opp-1');
    expect(updateArgs.data.convertedBy).toBe('u-1');
    expect(updateArgs.data.convertedAt).toBeInstanceOf(Date);
  });

  it('已转换机会（convertedAt 非空）→ 409 ALREADY_CONVERTED，不创建 Project', async () => {
    const tx = makeTx();
    tx.projectOpportunity.findFirst.mockResolvedValue({
      id: 'opp-1',
      name: '机会 A',
      customerId: 'bp-1',
      convertedAt: new Date(),
      project: null,
    });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'opp-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT');
    expect(tx.project.create).not.toHaveBeenCalled();
  });

  it('机会不存在 → 404，不创建 Project', async () => {
    const tx = makeTx();
    tx.$queryRaw.mockResolvedValue([]);
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'opp-999' }) });
    expect(res.status).toBe(404);
    expect(tx.project.create).not.toHaveBeenCalled();
  });

  it('无 project-opportunity:create 且无 project:create 权限 → 403，不触达事务', async () => {
    mockRequirePermission.mockReturnValue(
      NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: 'no' } }, { status: 403 }),
    );
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'opp-1' }) });
    expect(res.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});