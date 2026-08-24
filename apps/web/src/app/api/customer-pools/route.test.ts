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

import { GET, POST } from '@/app/api/customer-pools/route';

let poolMock: {
  count: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
};

function makeRequest(body: unknown, url = 'http://localhost/api/customer-pools'): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/customer-pools — Phase 2C 公海池创建', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    poolMock = {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'pool-1', code: 'POOL-SH', name: '上海区域池', scopeType: 'REGION', scopeValue: '华东' }),
    };
    mockPrisma.customerPool = poolMock;
  });

  it('创建 GLOBAL 池成功（scopeValue 空）', async () => {
    const res = await POST(makeRequest({ code: 'POOL-G', name: '全球池', scopeType: 'GLOBAL' }));
    expect(res.status).toBe(201);
  });

  it('创建 REGION 池成功（scopeValue 必填）', async () => {
    const res = await POST(makeRequest({ code: 'POOL-SH', name: '上海区域池', scopeType: 'REGION', scopeValue: '华东' }));
    expect(res.status).toBe(201);
    expect(poolMock.create).toHaveBeenCalledTimes(1);
  });

  it('GLOBAL + scopeValue → 400 POOL_SCOPE_INVALID（OQ-1 组合校验）', async () => {
    const res = await POST(makeRequest({ code: 'POOL-G2', name: '全球池', scopeType: 'GLOBAL', scopeValue: '华东' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('POOL_SCOPE_INVALID');
    expect(poolMock.create).not.toHaveBeenCalled();
  });

  it('REGION 缺 scopeValue → 400 POOL_SCOPE_INVALID', async () => {
    const res = await POST(makeRequest({ code: 'POOL-R', name: '区域池', scopeType: 'REGION' }));
    expect(res.status).toBe(400);
    expect(poolMock.create).not.toHaveBeenCalled();
  });

  it('code 已存在 → 409 POOL_CODE_EXISTS', async () => {
    poolMock.findUnique = vi.fn().mockResolvedValue({ id: 'pool-x', code: 'POOL-SH', deletedAt: null });
    const res = await POST(makeRequest({ code: 'POOL-SH', name: '上海池', scopeType: 'GLOBAL' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('POOL_CODE_EXISTS');
  });

  it('create P2002（并发 race）→ 409 POOL_CODE_EXISTS', async () => {
    poolMock.create = vi.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002', meta: { target: ['code'] } }));
    const res = await POST(makeRequest({ code: 'POOL-X', name: 'X池', scopeType: 'GLOBAL' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('POOL_CODE_EXISTS');
  });

  it('创建成功写 Audit customer-pool.create', async () => {
    await POST(makeRequest({ code: 'POOL-G', name: '全球池', scopeType: 'GLOBAL' }));
    const calls = (await import('@/lib/api-helpers')).writeAuditLog as ReturnType<typeof vi.fn>;
    expect(calls.mock.calls.some((c: unknown[]) => (c[0] as { action: string }).action === 'customer-pool.create')).toBe(true);
  });
});

describe('GET /api/customer-pools — 分页列表', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    poolMock = {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([{ id: 'pool-1', code: 'POOL-G', name: '全球池' }]),
      findUnique: vi.fn(),
      create: vi.fn(),
    };
    mockPrisma.customerPool = poolMock;
  });

  it('返回分页 + 计数', async () => {
    const res = await GET(new NextRequest('http://localhost/api/customer-pools?page=1&pageSize=20'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.total).toBe(1);
    expect(body.data.length).toBe(1);
  });
});
