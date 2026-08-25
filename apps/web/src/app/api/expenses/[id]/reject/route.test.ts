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

import { POST } from '@/app/api/expenses/[id]/reject/route';

type TxMock = { projectExpense: { findFirst: ReturnType<typeof vi.fn> } };

function makeTx(status: string, overrides: Partial<TxMock> = {}): TxMock {
  const existing = { id: 'exp-1', projectId: 'proj-1', approvalStatus: status, version: 5, deletedAt: null };
  const updated = {
    ...existing,
    approvalStatus: 'REJECTED',
    rejectionReason: '发票缺失',
    rejectedById: 'u-2',
    version: 6,
  };
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

function makeRequest(reason = '发票缺失'): NextRequest {
  return new NextRequest('http://localhost/api/expenses/exp-1/reject', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify({ version: 5, reason }),
  });
}

describe('POST /api/expenses/:id/reject — 报销驳回（PENDING → REJECTED）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockReturnValue(null);
    mockCasUpdate.mockResolvedValue({ outcome: 'OK' });
    mockPrisma.$transaction = vi.fn();
  });

  it('PENDING + 原因 + 版本匹配 → 200 REJECTED，rejectionReason/rejectedById 写入', async () => {
    const tx = makeTx('PENDING');
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'exp-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.approvalStatus).toBe('REJECTED');
    expect(body.data.rejectedById).toBe('u-2');
    const casData = mockCasUpdate.mock.calls[0][4] as Record<string, unknown>;
    expect(casData.approvalStatus).toBe('REJECTED');
    expect(casData.rejectionReason).toBe('发票缺失');
    expect(casData.rejectedById).toBe('u-2');
  });

  it('原因缺失 → 400 EXPENSE_REJECT_REASON_REQUIRED（不触达 DB）', async () => {
    const res = await POST(makeRequest('   '), { params: Promise.resolve({ id: 'exp-1' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('非 PENDING（APPROVED）→ 409 EXPENSE_INVALID_STATE（不触发 CAS）', async () => {
    const tx = makeTx('APPROVED');
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'exp-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('EXPENSE_INVALID_STATE');
    expect(mockCasUpdate).not.toHaveBeenCalled();
  });

  it('版本冲突 → 409 VERSION_CONFLICT', async () => {
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
