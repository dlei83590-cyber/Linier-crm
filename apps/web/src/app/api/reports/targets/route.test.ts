import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: {} as Record<string, unknown> }));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/api-helpers', () => ({
  authenticate: vi.fn().mockResolvedValue({ id: 'u-1', email: 'a@b.c', roles: ['SUPER_ADMIN'] }),
  requirePermission: vi.fn().mockReturnValue(null),
  requestMeta: vi.fn().mockReturnValue({ requestId: 'req-1' }),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  requestLog: vi.fn(),
}));

import { GET, POST } from '@/app/api/reports/targets/route';

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(url, { headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' }, ...init });
}

function buildMocks() {
  mockPrisma['reportTarget'] = {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({
      id: 't-new',
      period: '2026-08',
      dimensionType: 'SALES_AMOUNT',
      dimensionValue: 'ALL',
      targetAmount: { toString: () => '100000' },
      isActive: true,
      deletedAt: null,
    }),
    update: vi.fn().mockResolvedValue({
      id: 't-exist',
      period: '2026-08',
      dimensionType: 'SALES_AMOUNT',
      dimensionValue: 'ALL',
      targetAmount: { toString: () => '120000' },
      isActive: true,
      deletedAt: null,
    }),
  };
}

describe('GET /api/reports/targets — 经营目标列表（reports:view）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildMocks();
  });

  it('返回目标列表（可按 period / dimensionType 过滤）', async () => {
    const items = [
      { id: 't1', period: '2026-08', dimensionType: 'SALES_AMOUNT', dimensionValue: 'ALL', targetAmount: { toString: () => '100000' } },
      { id: 't2', period: '2026-08', dimensionType: 'NEW_CUSTOMERS', dimensionValue: 'ALL', targetAmount: { toString: () => '20' } },
    ];
    (mockPrisma['reportTarget'] as { findMany: ReturnType<typeof vi.fn> }).findMany.mockResolvedValue(items);
    const res = await GET(makeRequest('http://localhost/api/reports/targets?period=2026-08'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    const fm = (mockPrisma['reportTarget'] as { findMany: ReturnType<typeof vi.fn> }).findMany;
    expect(fm.mock.calls[0][0].where).toEqual({ deletedAt: null, period: '2026-08' });
  });

  it('无 reports:view 权限 → 403（不触达 DB）', async () => {
    const helpers = await import('@/lib/api-helpers');
    (helpers.requirePermission as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: '无权限' } }, { status: 403 }),
    );
    const res = await GET(makeRequest('http://localhost/api/reports/targets'));
    expect(res.status).toBe(403);
    expect((mockPrisma['reportTarget'] as { findMany: ReturnType<typeof vi.fn> }).findMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/reports/targets — 经营目标 upsert（reports:edit）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildMocks();
  });

  it('新目标（period+dimensionType+dimensionValue 不存在）→ 201 创建，dimensionValue 默认 ALL', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/reports/targets', {
        method: 'POST',
        body: JSON.stringify({ period: '2026-08', dimensionType: 'SALES_AMOUNT', targetAmount: 100000 }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.dimensionType).toBe('SALES_AMOUNT');
    const rt = mockPrisma['reportTarget'] as {
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    expect(rt.create).toHaveBeenCalledTimes(1);
    expect(rt.update).not.toHaveBeenCalled();
    const createArgs = rt.create.mock.calls[0][0].data;
    expect(createArgs).toMatchObject({ period: '2026-08', dimensionType: 'SALES_AMOUNT', dimensionValue: 'ALL', targetAmount: 100000, createdById: 'u-1' });
  });

  it('同键目标已存在 → 200 更新（targetAmount 覆盖，version 递增）', async () => {
    const rt = mockPrisma['reportTarget'] as {
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    rt.findFirst.mockResolvedValue({
      id: 't-exist',
      period: '2026-08',
      dimensionType: 'SALES_AMOUNT',
      dimensionValue: 'ALL',
      targetAmount: { toString: () => '100000' },
      version: 1,
      deletedAt: null,
    });
    const res = await POST(
      makeRequest('http://localhost/api/reports/targets', {
        method: 'POST',
        body: JSON.stringify({ period: '2026-08', dimensionType: 'SALES_AMOUNT', targetAmount: 120000 }),
      }),
    );
    expect(res.status).toBe(200);
    const rtUpdate = rt.update.mock.calls[0][0];
    expect(rtUpdate.where).toEqual({ id: 't-exist' });
    expect(rtUpdate.data).toMatchObject({ targetAmount: 120000, updatedById: 'u-1', version: { increment: 1 } });
    expect(rt.create).not.toHaveBeenCalled();
  });

  it('目标金额非正数 → 400 VALIDATION_ERROR（不触达 DB）', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/reports/targets', {
        method: 'POST',
        body: JSON.stringify({ period: '2026-08', dimensionType: 'SALES_AMOUNT', targetAmount: -5 }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect((mockPrisma['reportTarget'] as { findFirst: ReturnType<typeof vi.fn> }).findFirst).not.toHaveBeenCalled();
  });

  it('period 非法（非 YYYY/YYYY-MM/YYYY-MM-DD）→ 400', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/reports/targets', {
        method: 'POST',
        body: JSON.stringify({ period: '202608', dimensionType: 'SALES_AMOUNT', targetAmount: 100 }), // 形状非法（缺分隔符）
      }),
    );
    expect(res.status).toBe(400);
  });

  it('dimensionType 不在白名单 → 400', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/reports/targets', {
        method: 'POST',
        body: JSON.stringify({ period: '2026-08', dimensionType: 'REVENUE', targetAmount: 100 }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('无 reports:edit 权限 → 403（不触达 DB）', async () => {
    const helpers = await import('@/lib/api-helpers');
    (helpers.requirePermission as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: '无权限' } }, { status: 403 }),
    );
    const res = await POST(
      makeRequest('http://localhost/api/reports/targets', {
        method: 'POST',
        body: JSON.stringify({ period: '2026-08', dimensionType: 'SALES_AMOUNT', targetAmount: 100 }),
      }),
    );
    expect(res.status).toBe(403);
    expect((mockPrisma['reportTarget'] as { findFirst: ReturnType<typeof vi.fn> }).findFirst).not.toHaveBeenCalled();
  });
});
