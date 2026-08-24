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

import { GET } from '@/app/api/expenses/route';

const expenseRow = {
  id: 'exp-1',
  projectId: 'proj-1',
  category: '差旅费',
  amount: '128.50',
  currency: 'CNY',
  incurredAt: new Date('2026-08-20T00:00:00.000Z'),
  note: '上海客户现场',
  approvalStatus: 'APPROVED',
  createdAt: new Date('2026-08-21T00:00:00.000Z'),
  deletedAt: null,
  project: {
    id: 'proj-1',
    code: 'PRJ-001',
    name: '华东区项目',
    stage: 'SAMPLING',
    customer: { id: 'bp-1', code: 'BP-001', name: '新客户有限公司', type: 'CUSTOMER' },
  },
};

describe('GET /api/expenses — 报销申请列表（只读聚合 ProjectExpense + 客户归属）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockReturnValue(null);
    mockPrisma.projectExpense = {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([expenseRow]),
    };
  });

  it('无筛选 → 200 分页列表，且 include 项目客户归属（Project → BusinessPartner）', async () => {
    const res = await GET(new NextRequest('http://localhost/api/expenses'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.total).toBe(1);
    expect(body.data[0].project.customer.name).toBe('新客户有限公司');
    const findManyMock = mockPrisma.projectExpense as { findMany: ReturnType<typeof vi.fn> };
    const findArgs = findManyMock.findMany.mock.calls[0][0];
    expect(findArgs.where.deletedAt).toBeNull();
    expect(findArgs.include.project.select.customer.select.name).toBe(true);
  });

  it('customerId 筛选 → where 走 project.customerId（客户归属直接投影，不新造字段）', async () => {
    await GET(new NextRequest('http://localhost/api/expenses?customerId=bp-1'));
    const findManyMock = mockPrisma.projectExpense as { findMany: ReturnType<typeof vi.fn> };
    const where = findManyMock.findMany.mock.calls[0][0].where;
    expect(where.project.customerId).toBe('bp-1');
  });

  it('projectId 筛选 → where.projectId 精确匹配', async () => {
    await GET(new NextRequest('http://localhost/api/expenses?projectId=proj-1'));
    const findManyMock = mockPrisma.projectExpense as { findMany: ReturnType<typeof vi.fn> };
    expect(findManyMock.findMany.mock.calls[0][0].where.projectId).toBe('proj-1');
  });

  it('category 筛选 → where.category contains 模糊匹配', async () => {
    await GET(new NextRequest('http://localhost/api/expenses?category=差旅'));
    const findManyMock = mockPrisma.projectExpense as { findMany: ReturnType<typeof vi.fn> };
    expect(findManyMock.findMany.mock.calls[0][0].where.category.contains).toBe('差旅');
  });

  it('无 project-expense:view 权限 → 403 FORBIDDEN（不触达 DB）', async () => {
    mockRequirePermission.mockReturnValue(
      NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permission' } },
        { status: 403 },
      ),
    );
    const res = await GET(new NextRequest('http://localhost/api/expenses'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
    const findManyMock = mockPrisma.projectExpense as { findMany: ReturnType<typeof vi.fn> };
    expect(findManyMock.findMany).not.toHaveBeenCalled();
  });
});
