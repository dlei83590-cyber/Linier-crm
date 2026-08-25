import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { mockPrisma, mockRequirePermission, mockLockProjectHeader } = vi.hoisted(() => ({
  mockPrisma: {} as Record<string, unknown>,
  mockRequirePermission: vi.fn(),
  mockLockProjectHeader: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/api-helpers', () => ({
  authenticate: vi.fn().mockResolvedValue({ id: 'u-1', email: 'a@b.c', roles: ['SUPER_ADMIN'] }),
  requirePermission: mockRequirePermission,
  requestMeta: vi.fn().mockReturnValue({ requestId: 'req-1' }),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  lockProjectHeader: mockLockProjectHeader,
  requestLog: vi.fn(),
}));

import { POST } from '@/app/api/projects/[id]/close/route';

type TxMock = {
  projectClosure: { create: ReturnType<typeof vi.fn> };
  project: { update: ReturnType<typeof vi.fn> };
  projectProgress: { create: ReturnType<typeof vi.fn> };
  projectTask: { count: ReturnType<typeof vi.fn> };
  projectRisk: { count: ReturnType<typeof vi.fn> };
  projectAcceptance: { findMany: ReturnType<typeof vi.fn> };
};

function makeTx(overrides: Partial<TxMock> = {}): TxMock {
  return {
    projectClosure: {
      create: vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({ id: 'cl-1', projectId: data.projectId, reason: data.reason }),
      ),
    },
    project: {
      update: vi.fn().mockResolvedValue({ id: 'proj-1', stage: 'CLOSED', version: 3 }),
    },
    projectProgress: { create: vi.fn().mockResolvedValue({ id: 'pr-1' }) },
    projectTask: { count: vi.fn().mockResolvedValue(0) },
    projectRisk: { count: vi.fn().mockResolvedValue(0) },
    projectAcceptance: {
      findMany: vi.fn().mockResolvedValue([{ result: 'PASSED' }]),
    },
    ...overrides,
  };
}

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/projects/proj-1/close', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/projects/:id/close — 项目结项（FRT-05 结项按钮消费契约）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockReturnValue(null);
    mockLockProjectHeader.mockResolvedValue({
      id: 'proj-1',
      stage: 'MASS_SUPPLY',
      version: 2,
      paymentStatus: 'PAID',
      receivableBalance: '0',
    });
    mockPrisma.$transaction = vi.fn();
  });

  it('无阻断 + version 匹配 → 创建 Closure + stage=CLOSED + version+1，返回 CLOSED', async () => {
    const tx = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest({ reason: '客户验收通过', version: 2 }), {
      params: Promise.resolve({ id: 'proj-1' }),
    });
    if (!res) throw new Error('expected response');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.stage).toBe('CLOSED');
    // Closure 记录原因 + 操作人
    const closureArgs = (tx.projectClosure.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(closureArgs.data.reason).toBe('客户验收通过');
    expect(closureArgs.data.createdById).toBe('u-1');
    // Project update 置 CLOSED + version+1（不本地推导）
    const projArgs = (tx.project.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(projArgs.data.stage).toBe('CLOSED');
    expect(projArgs.data.version).toEqual({ increment: 1 });
    // 非 force：不创建 100% Progress 记录
    expect(tx.projectProgress.create).not.toHaveBeenCalled();
  });

  it('version CAS 不匹配 → 409 VERSION_CONFLICT，不创建 Closure', async () => {
    const tx = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest({ reason: '结项', version: 1 }), {
      params: Promise.resolve({ id: 'proj-1' }),
    });
    if (!res) throw new Error('expected response');
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('VERSION_CONFLICT');
    expect(tx.projectClosure.create).not.toHaveBeenCalled();
  });

  it('存在未完成任务（非 force）→ 409 业务阻断，展示真实阻断原因', async () => {
    const tx = makeTx();
    tx.projectTask.count.mockResolvedValue(2);
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest({ reason: '想结项', version: 2 }), {
      params: Promise.resolve({ id: 'proj-1' }),
    });
    if (!res) throw new Error('expected response');
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.message).toContain('未完成任务');
    expect(tx.projectClosure.create).not.toHaveBeenCalled();
  });

  it('force=true 需 project:approve 双权限；无 approve → 403', async () => {
    mockRequirePermission.mockImplementation((_u: unknown, perm: string) => {
      if (perm === 'project:close') return null;
      if (perm === 'project:approve') {
        return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: 'no' } }, { status: 403 });
      }
      return null;
    });
    const res = await POST(makeRequest({ reason: '强制', version: 2, force: true }), {
      params: Promise.resolve({ id: 'proj-1' }),
    });
    if (!res) throw new Error('expected response');
    expect(res.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('force=true + 双权限 + 有阻断 → 强制结项：Closure + CLOSED + 100% Progress 记录', async () => {
    const tx = makeTx();
    tx.projectTask.count.mockResolvedValue(2);
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest({ reason: '客户要求提前结束', version: 2, force: true }), {
      params: Promise.resolve({ id: 'proj-1' }),
    });
    if (!res) throw new Error('expected response');
    expect(res.status).toBe(200);
    const projArgs = (tx.project.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(projArgs.data.stage).toBe('CLOSED');
    expect(projArgs.data.progressPercent).toBe(100);
    const progressArgs = (tx.projectProgress.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(progressArgs.data.progressPercent).toBe(100);
  });
});