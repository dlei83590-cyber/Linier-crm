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
  authenticate: vi.fn().mockResolvedValue({ id: 'u-2', email: 'approver@b.c', roles: ['ADMIN'] }),
  requirePermission: mockRequirePermission,
  requestMeta: vi.fn().mockReturnValue({ requestId: 'req-1' }),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  requestLog: vi.fn(),
}));

import { POST } from '@/app/api/expenses/[id]/approve/route';

type TxMock = { projectExpense: { findFirst: ReturnType<typeof vi.fn> } };

function makeTx(status: string, overrides: Partial<TxMock> = {}): TxMock {
  const existing = { id: 'exp-1', projectId: 'proj-1', approvalStatus: status, version: 5, deletedAt: null };
  const updated = { ...existing, approvalStatus: 'APPROVED', approvedById: 'u-2', version: 6 };
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
  return new NextRequest('http://localhost/api/expenses/exp-1/approve', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify({ version: 5 }),
  });
}

describe('POST /api/expenses/:id/approve — 报销批准（PENDING → APPROVED）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockReturnValue(null);
    mockCasUpdate.mockResolvedValue({ outcome: 'OK' });
    mockPrisma.$transaction = vi.fn();
  });

  it('PENDING + 版本匹配 → 200 APPROVED，approvedById=审批人', async () => {
    const tx = makeTx('PENDING');
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'exp-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.approvalStatus).toBe('APPROVED');
    expect(body.data.approvedById).toBe('u-2');
    expect(mockCasUpdate.mock.calls[0][4].approvalStatus).toBe('APPROVED');
    expect(mockCasUpdate.mock.calls[0][4].approvedById).toBe('u-2');
  });

  it('非 PENDING（DRAFT）→ 409 EXPENSE_INVALID_STATE（不触发 CAS）', async () => {
    const tx = makeTx('DRAFT');
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'exp-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('EXPENSE_INVALID_STATE');
    expect(mockCasUpdate).not.toHaveBeenCalled();
  });

  it('已批准幂等拒绝 → 409 EXPENSE_INVALID_STATE', async () => {
    const tx = makeTx('APPROVED');
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'exp-1' }) });
    expect(res.status).toBe(409);
  });

  it('版本冲突 → 409 VERSION_CONFLICT（并发批准互斥）', async () => {
    const tx = makeTx('PENDING');
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    mockCasUpdate.mockResolvedValue({ outcome: 'CONFLICT' });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'exp-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('VERSION_CONFLICT');
  });

  it('无 project-expense:approve 权限 → 403（不触达 DB）', async () => {
    mockRequirePermission.mockReturnValue(
      NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: 'no' } }, { status: 403 }),
    );
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'exp-1' }) });
    expect(res.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
