import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: {} as Record<string, unknown> }));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/api-helpers', () => ({
  authenticate: vi.fn().mockResolvedValue({ id: 'u-1', email: 'a@b.c', roles: ['SUPER_ADMIN'] }),
  requirePermission: vi.fn().mockReturnValue(null),
  requestMeta: vi.fn().mockReturnValue({ requestId: 'req-1' }),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  requestLog: vi.fn(),
}));

import { POST } from '@/app/api/unit-of-measures/route';

/**
 * 计量单位新建：500 修复 + 软删占位复活（误删后重建同编码成功，不再拒绝）。
 */

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/unit-of-measures', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/unit-of-measures — 新建计量单位（500 修复 + 软删复活）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('全新编码 → 201 创建', async () => {
    mockPrisma.unitOfMeasure = {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'uom-1', code: 'KG', name: '千克', symbol: 'kg' }),
    };
    const res = await POST(makeRequest({ code: 'KG', name: '千克', symbol: 'kg' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.code).toBe('KG');
  });

  it('active 记录占用同编码 → 409 CONFLICT（真冲突）', async () => {
    mockPrisma.unitOfMeasure = {
      findUnique: vi.fn().mockResolvedValue({ id: 'uom-1', code: 'KG', deletedAt: null }),
      create: vi.fn(),
    };
    const res = await POST(makeRequest({ code: 'KG', name: '千克' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.message).toBe('计量单位编码已存在');
  });

  it('软删记录占位同编码 → 201 复活（deletedAt 置空 + 更新字段）', async () => {
    mockPrisma.unitOfMeasure = {
      findUnique: vi.fn().mockResolvedValue({ id: 'uom-old', code: 'KG', name: '旧名', deletedAt: new Date() }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'uom-old', code: 'KG', name: '千克', symbol: 'kg', isActive: true, deletedAt: null, version: 2,
      }),
      create: vi.fn(),
    };
    const res = await POST(makeRequest({ code: 'KG', name: '千克', symbol: 'kg' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBe('uom-old');
    expect(body.data.deletedAt).toBeNull();

    const updateArgs = (mockPrisma.unitOfMeasure.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'uom-old', deletedAt: { not: null } });
    expect(updateArgs.data.deletedAt).toBeNull();
    expect(updateArgs.data.name).toBe('千克');
  });

  it('并发下已被其他请求复活 → 幂等返回当前记录 201（不重复创建）', async () => {
    mockPrisma.unitOfMeasure = {
      findUnique: vi.fn().mockResolvedValue({ id: 'uom-old', code: 'KG', name: '旧名', deletedAt: new Date() }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'uom-old', code: 'KG', name: '千克', isActive: true, deletedAt: null, version: 2,
      }),
      create: vi.fn(),
    };
    const res = await POST(makeRequest({ code: 'KG', name: '千克' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBe('uom-old');
    expect(mockPrisma.unitOfMeasure.create).not.toHaveBeenCalled();
  });

  it('其他数据库运行时错误 → 500 结构化（INTERNAL_ERROR，不泄露 stack）', async () => {
    mockPrisma.unitOfMeasure = {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockRejectedValue(new Error('connection refused')),
    };
    const res = await POST(makeRequest({ code: 'NEW', name: '新单位' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).not.toContain('connection refused');
  });
});
