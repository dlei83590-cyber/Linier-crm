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
}));
vi.mock('@/lib/api/logger', () => ({ requestLog: vi.fn() }));

import { GET } from '@/app/api/expenses/[id]/route';

const expenseRow = {
  id: 'exp-1',
  projectId: 'proj-1',
  category: '交通费',
  amount: '88.00',
  currency: 'CNY',
  incurredAt: new Date('2026-08-19T00:00:00.000Z'),
  note: null,
  approvalStatus: 'APPROVED',
  createdAt: new Date('2026-08-20T00:00:00.000Z'),
  deletedAt: null,
  project: {
    id: 'proj-1',
    code: 'PRJ-001',
    name: '华东区项目',
    stage: 'SAMPLING',
    customer: { id: 'bp-1', code: 'BP-001', name: '新客户有限公司', type: 'CUSTOMER' },
  },
};

describe('GET /api/expenses/:id — 报销申请详情', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockReturnValue(null);
  });

  it('存在 → 200 详情含项目客户归属', async () => {
    mockPrisma.projectExpense = { findFirst: vi.fn().mockResolvedValue(expenseRow) };
    const res = await GET(new NextRequest('http://localhost/api/expenses/exp-1'), {
      params: Promise.resolve({ id: 'exp-1' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe('exp-1');
    expect(body.data.project.customer.code).toBe('BP-001');
    const findFirstMock = mockPrisma.projectExpense as { findFirst: ReturnType<typeof vi.fn> };
    expect(findFirstMock.findFirst.mock.calls[0][0].where).toEqual({ id: 'exp-1', deletedAt: null });
  });

  it('详情含申请人/审批人投影（createdById → User 二次查询组装）', async () => {
    mockPrisma.projectExpense = {
      findFirst: vi.fn().mockResolvedValue({
        ...expenseRow,
        createdById: 'u-9',
        approvedById: 'u-8',
        rejectedById: null,
      }),
    };
    mockPrisma.user = {
      findMany: vi.fn().mockResolvedValue([
        { id: 'u-9', name: '张三', email: 'zhang@b.c' },
        { id: 'u-8', name: '李四', email: 'li@b.c' },
      ]),
    };
    const res = await GET(new NextRequest('http://localhost/api/expenses/exp-1'), {
      params: Promise.resolve({ id: 'exp-1' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.createdBy.name).toBe('张三');
    expect(body.data.approvedBy.name).toBe('李四');
    expect(body.data.rejectedBy).toBeNull();
    const userMock = mockPrisma.user as { findMany: ReturnType<typeof vi.fn> };
    const userWhere = userMock.findMany.mock.calls[0][0].where;
    expect(userWhere.id.in.sort()).toEqual(['u-8', 'u-9']);
  });

  it('不存在或已软删 → 404 NOT_FOUND', async () => {
    mockPrisma.projectExpense = { findFirst: vi.fn().mockResolvedValue(null) };
    const res = await GET(new NextRequest('http://localhost/api/expenses/exp-x'), {
      params: Promise.resolve({ id: 'exp-x' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('无 project-expense:view 权限 → 403 FORBIDDEN（不触达 DB）', async () => {
    mockRequirePermission.mockReturnValue(
      NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permission' } },
        { status: 403 },
      ),
    );
    mockPrisma.projectExpense = { findFirst: vi.fn() };
    const res = await GET(new NextRequest('http://localhost/api/expenses/exp-1'), {
      params: Promise.resolve({ id: 'exp-1' }),
    });
    expect(res.status).toBe(403);
    const findFirstMock = mockPrisma.projectExpense as { findFirst: ReturnType<typeof vi.fn> };
    expect(findFirstMock.findFirst).not.toHaveBeenCalled();
  });
});
