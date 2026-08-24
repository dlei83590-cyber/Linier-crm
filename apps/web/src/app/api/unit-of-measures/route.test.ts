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
 * 计量单位新建 500 修复：P2002（软删记录占位同编码）→ 409 友好提示；其他运行时错误 → 结构化 500。
 */

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/unit-of-measures', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/unit-of-measures — 新建计量单位（500 修复）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('正常创建 → 201', async () => {
    mockPrisma.unitOfMeasure = {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'uom-1', code: 'KG', name: '千克', symbol: 'kg' }),
    };
    const res = await POST(makeRequest({ code: 'KG', name: '千克', symbol: 'kg' }));
    expect(res.status).toBe(201);
  });

  it('软删记录占位同编码 → create P2002 → 409 CONFLICT（友好提示，不再 500）', async () => {
    mockPrisma.unitOfMeasure = {
      // findUnique 命中软删记录 → 放行 → create 撞 @unique → P2002
      findUnique: vi.fn().mockResolvedValue({ id: 'uom-old', code: 'KG', deletedAt: new Date() }),
      create: vi.fn().mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })),
    };
    const res = await POST(makeRequest({ code: 'KG', name: '千克' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.message).toContain('历史删除记录仍占用');
  });

  it('其他数据库运行时错误 → 500 结构化（INTERNAL_ERROR + requestId，不泄露 stack）', async () => {
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
