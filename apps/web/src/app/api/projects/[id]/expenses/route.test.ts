import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { mockPrisma, mockRequirePermission, mockAssertProjectWritable } = vi.hoisted(() => ({
  mockPrisma: {} as Record<string, unknown>,
  mockRequirePermission: vi.fn(),
  mockAssertProjectWritable: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/api-helpers', () => ({
  authenticate: vi.fn().mockResolvedValue({ id: 'u-1', email: 'a@b.c', roles: ['SUPER_ADMIN'] }),
  requirePermission: mockRequirePermission,
  requestMeta: vi.fn().mockReturnValue({ requestId: 'req-1' }),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  assertProjectWritable: mockAssertProjectWritable,
  requestLog: vi.fn(),
}));

import { POST } from '@/app/api/projects/[id]/expenses/route';

type TxMock = { projectExpense: { create: ReturnType<typeof vi.fn> } };

function makeTx(overrides: Partial<TxMock> = {}): TxMock {
  return {
    projectExpense: {
      create: vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({ id: 'exp-new', ...data, amount: String(data.amount) }),
      ),
    },
    ...overrides,
  };
}

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/projects/proj-1/expenses', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/projects/:id/expenses — 新建报销申请（报销流程补齐，Migration 0051）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockReturnValue(null);
    mockAssertProjectWritable.mockResolvedValue({ ok: true });
    mockPrisma.$transaction = vi.fn();
  });

  it('创建默认 DRAFT（走提交→批准/驳回流程，不再创建即 APPROVED）+ 费用类型/归属落库', async () => {
    const tx = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest({ category: '差旅费', expenseType: '差旅', expenseAttribution: '公司承担', amount: 128.5, currency: 'CNY' }), {
      params: Promise.resolve({ id: 'proj-1' }),
    });
    expect(res.status).toBe(201);
    const createArgs = (tx.projectExpense.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArgs.data.approvalStatus).toBe('DRAFT');
    expect(createArgs.data.expenseType).toBe('差旅');
    expect(createArgs.data.expenseAttribution).toBe('公司承担');
    expect(createArgs.data.projectId).toBe('proj-1');
    expect(createArgs.data.createdById).toBe('u-1');
  });

  it('费用类型/归属可省略（存量表单兼容）→ 创建成功且字段为 null', async () => {
    const tx = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest({ category: '交通费', amount: 88 }), {
      params: Promise.resolve({ id: 'proj-1' }),
    });
    expect(res.status).toBe(201);
    const createArgs = (tx.projectExpense.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArgs.data.expenseType).toBeNull();
    expect(createArgs.data.expenseAttribution).toBeNull();
  });

  it('项目不可写（assertProjectWritable 拒绝）→ 409/403 拒绝，不创建', async () => {
    mockAssertProjectWritable.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: '项目不可写' } }, { status: 403 }),
    });
    const tx = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest({ category: '差旅费', amount: 100 }), {
      params: Promise.resolve({ id: 'proj-1' }),
    });
    expect(res.status).toBe(403);
    expect(tx.projectExpense.create).not.toHaveBeenCalled();
  });

  it('金额为负 → 400 VALIDATION_ERROR（不触达事务）', async () => {
    const res = await POST(makeRequest({ category: '差旅费', amount: -5 }), {
      params: Promise.resolve({ id: 'proj-1' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('无 project-expense:create 权限 → 403（不触达 DB）', async () => {
    mockRequirePermission.mockReturnValue(
      NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: 'no' } }, { status: 403 }),
    );
    const res = await POST(makeRequest({ category: '差旅费', amount: 100 }), {
      params: Promise.resolve({ id: 'proj-1' }),
    });
    expect(res.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
