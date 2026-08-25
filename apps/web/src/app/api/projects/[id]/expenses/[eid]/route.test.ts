import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { mockPrisma, mockRequirePermission, mockAssertProjectWritable, mockCasUpdate } = vi.hoisted(() => ({
  mockPrisma: {} as Record<string, unknown>,
  mockRequirePermission: vi.fn(),
  mockAssertProjectWritable: vi.fn(),
  mockCasUpdate: vi.fn(),
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
vi.mock('@/lib/api/cas', () => ({ casUpdate: mockCasUpdate }));

import { PATCH } from '@/app/api/projects/[id]/expenses/[eid]/route';

type TxMock = {
  projectExpense: {
    findFirst: ReturnType<typeof vi.fn>;
  };
};

function makeTx(existing: Record<string, unknown>, updated: Record<string, unknown>): TxMock {
  const findFirst = vi
    .fn()
    .mockResolvedValueOnce(existing)
    .mockResolvedValueOnce(updated);
  return { projectExpense: { findFirst } };
}

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/projects/proj-1/expenses/exp-1', {
    method: 'PATCH',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const baseExisting = {
  id: 'exp-1',
  projectId: 'proj-1',
  category: '差旅费',
  amount: '100',
  approvalStatus: 'DRAFT',
  version: 3,
  deletedAt: null,
};

describe('PATCH /api/projects/:id/expenses/:eid — 报销编辑/改稿门禁（FRT-09 报销闭环）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockReturnValue(null);
    mockAssertProjectWritable.mockResolvedValue({ ok: true });
    mockPrisma.$transaction = vi.fn();
  });

  it('DRAFT 可编辑（提交前改稿）→ 200，字段更新且 version 乐观锁传参', async () => {
    const tx = makeTx(baseExisting, { ...baseExisting, category: '交通费', amount: '120', version: 4 });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    mockCasUpdate.mockResolvedValue({ outcome: 'OK' });
    const res = await PATCH(makeRequest({ version: 3, category: '交通费', amount: 120 }), {
      params: Promise.resolve({ id: 'proj-1', eid: 'exp-1' }),
    });
    expect(res.status).toBe(200);
    expect(mockCasUpdate).toHaveBeenCalledWith(
      expect.anything(),
      'projectExpense',
      'exp-1',
      3,
      expect.objectContaining({ category: '交通费', updatedById: 'u-1' }),
    );
  });

  it('REJECTED 可改稿（驳回后再编辑）→ 200', async () => {
    const tx = makeTx(
      { ...baseExisting, approvalStatus: 'REJECTED' },
      { ...baseExisting, approvalStatus: 'REJECTED', note: '已按驳回意见修改', version: 4 },
    );
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    mockCasUpdate.mockResolvedValue({ outcome: 'OK' });
    const res = await PATCH(makeRequest({ version: 3, note: '已按驳回意见修改' }), {
      params: Promise.resolve({ id: 'proj-1', eid: 'exp-1' }),
    });
    expect(res.status).toBe(200);
    expect(mockCasUpdate).toHaveBeenCalled();
  });

  it('PENDING 冻结（审批中禁改）→ 409 EXPENSE_INVALID_STATE，不触达 CAS', async () => {
    const tx = makeTx({ ...baseExisting, approvalStatus: 'PENDING' }, {});
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await PATCH(makeRequest({ version: 3, amount: 200 }), {
      params: Promise.resolve({ id: 'proj-1', eid: 'exp-1' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('EXPENSE_INVALID_STATE');
    expect(mockCasUpdate).not.toHaveBeenCalled();
  });

  it('APPROVED 冻结（已批准禁改）→ 409 EXPENSE_INVALID_STATE', async () => {
    const tx = makeTx({ ...baseExisting, approvalStatus: 'APPROVED' }, {});
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await PATCH(makeRequest({ version: 3, category: '办公费' }), {
      params: Promise.resolve({ id: 'proj-1', eid: 'exp-1' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('EXPENSE_INVALID_STATE');
    expect(mockCasUpdate).not.toHaveBeenCalled();
  });

  it('version 冲突（CAS CONFLICT）→ 409 VERSION_CONFLICT（前端走 onReload 重新加载）', async () => {
    const tx = makeTx(baseExisting, {});
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    mockCasUpdate.mockResolvedValue({ outcome: 'CONFLICT' });
    const res = await PATCH(makeRequest({ version: 2, amount: 120 }), {
      params: Promise.resolve({ id: 'proj-1', eid: 'exp-1' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('VERSION_CONFLICT');
  });

  it('无 project-expense:edit 权限 → 403（不触达 DB）', async () => {
    mockRequirePermission.mockReturnValue(
      NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: 'no' } }, { status: 403 }),
    );
    const res = await PATCH(makeRequest({ version: 3, amount: 120 }), {
      params: Promise.resolve({ id: 'proj-1', eid: 'exp-1' }),
    });
    expect(res.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
