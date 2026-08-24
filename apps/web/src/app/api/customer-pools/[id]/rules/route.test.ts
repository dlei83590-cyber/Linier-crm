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

import { POST, GET } from '@/app/api/customer-pools/[id]/rules/route';

let ruleMock: {
  findMany: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
};

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/customer-pools/pool-1/rules', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/customer-pools/:id/rules — Phase 2C 规则', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ruleMock = {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'rule-1', poolId: 'pool-1', ruleType: 'FIELD_MATCH', priority: 10 }),
    };
    mockPrisma.customerPool = { findFirst: vi.fn().mockResolvedValue({ id: 'pool-1', deletedAt: null }) };
    mockPrisma.customerPoolRule = ruleMock;
  });

  it('FIELD_MATCH 合法规则 → 201', async () => {
    const res = await POST(makeRequest({
      ruleType: 'FIELD_MATCH',
      matchMode: 'ANY',
      condition: [{ field: 'region', operator: 'EQ', value: '华东' }],
      priority: 10,
    }));
    expect(res.status).toBe(201);
  });

  it('INACTIVITY 规则 → 400 POOL_RULE_SOURCE_UNAVAILABLE（Phase 3 前禁用）', async () => {
    const res = await POST(makeRequest({
      ruleType: 'INACTIVITY',
      matchMode: 'ANY',
      condition: [{ field: 'region', operator: 'EQ', value: '华东' }],
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('POOL_RULE_SOURCE_UNAVAILABLE');
    expect(ruleMock.create).not.toHaveBeenCalled();
  });

  it('白名单外字段 → 400 POOL_RULE_INVALID（fail closed）', async () => {
    const res = await POST(makeRequest({
      ruleType: 'FIELD_MATCH',
      matchMode: 'ANY',
      condition: [{ field: 'ownerId', operator: 'EQ', value: 'u-1' }],
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('POOL_RULE_INVALID');
  });

  it('pool 不存在 → 404 POOL_NOT_FOUND', async () => {
    mockPrisma.customerPool = { findFirst: vi.fn().mockResolvedValue(null) };
    const res = await POST(makeRequest({
      ruleType: 'FIELD_MATCH',
      matchMode: 'ANY',
      condition: [{ field: 'region', operator: 'EQ', value: '华东' }],
    }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('POOL_NOT_FOUND');
  });

  it('GET 规则列表（pool 存在）', async () => {
    const res = await GET(new NextRequest('http://localhost/api/customer-pools/pool-1/rules'), { params: Promise.resolve({ id: 'pool-1' }) });
    expect(res.status).toBe(200);
  });
});
