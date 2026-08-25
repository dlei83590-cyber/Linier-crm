import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { mockPrisma, mockRequirePermission, mockCasUpdate } = vi.hoisted(() => ({
  mockPrisma: {} as Record<string, unknown>,
  mockRequirePermission: vi.fn(),
  mockCasUpdate: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/api/cas', () => ({ casUpdate: mockCasUpdate }));
vi.mock('@/lib/api-helpers', () => ({
  authenticate: vi.fn().mockResolvedValue({ id: 'u-1', email: 'a@b.c', roles: ['SUPER_ADMIN'] }),
  requirePermission: mockRequirePermission,
  requestMeta: vi.fn().mockReturnValue({ requestId: 'req-1' }),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  requestLog: vi.fn(),
}));
vi.mock('@/lib/api/logger', () => ({ requestLog: vi.fn() }));

import { POST } from '@/app/api/expenses/[id]/submit/route';

type TxMock = { projectExpense: { findFirst: ReturnType<typeof vi.fn> } };

function makeTx(status: string, overrides: Partial<TxMock> = {}): TxMock {
  const existing = { id: 'exp-1', projectId: 'proj-1', approvalStatus: status, version: 3, deletedAt: null };
  const updated = { ...existing, approvalStatus: 'PENDING', version: 4, updatedById: 'u-1' };
  return {
    projectExpense: {
      findFirst: vi
        .fn()
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(updated),
    },
    ...overrides,
  };
}

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/expenses/exp-1/submit', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify({ version: 3 }),
  });
}

describe('POST /api/expenses/:id/submit — 报销提交审批（DRAFT|REJECTED → PENDING）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockReturnValue(null);
    mockCasUpdate.mockResolvedValue({ outcome: 'OK' });
    mockPrisma.$transaction = vi.fn();
  });

  it('DRAFT + 版本匹配 → 200，approvalStatus=PENDING，CAS 写入 updatedById', async () => {
    const tx = makeTx('DRAFT');
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'exp-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.approvalStatus).toBe('PENDING');
    const casArgs = mockCasUpdate.mock.calls[0];
    expect(casArgs[1]).toBe('projectExpense');
    expect(casArgs[3]).toBe(3);
    expect(casArgs[4].approvalStatus).toBe('PENDING');
  });

  it('REJECTED（驳回后改稿再提交）→ 200 PENDING', async () => {
    const tx = makeTx('REJECTED');
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'exp-1' }) });
    expect(res.status).toBe(200);
  });

  it('APPROVED 终态 → 409 EXPENSE_INVALID_STATE（不触发 CAS）', async () => {
    const tx = makeTx('APPROVED');
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'exp-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('EXPENSE_INVALID_STATE');
    expect(mockCasUpdate).not.toHaveBeenCalled();
  });

  it('版本冲突 → 409 VERSION_CONFLICT', async () => {
    const tx = makeTx('DRAFT');
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    mockCasUpdate.mockResolvedValue({ outcome: 'CONFLICT' });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'exp-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('VERSION_CONFLICT');
  });

  it('不存在 → 404 EXPENSE_NOT_FOUND', async () => {
    const tx = makeTx('DRAFT', {
      projectExpense: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'exp-x' }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('EXPENSE_NOT_FOUND');
  });

  it('无 project-expense:edit 权限 → 403（不触达 DB）', async () => {
    mockRequirePermission.mockReturnValue(
      NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: 'no' } }, { status: 403 }),
    );
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'exp-1' }) });
    expect(res.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
