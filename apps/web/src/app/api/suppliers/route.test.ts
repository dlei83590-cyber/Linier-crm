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

import { GET, POST } from '@/app/api/suppliers/route';

/**
 * FRT-02 契约测试：Customer 360「供应商」Tab selector 依赖的 /api/suppliers 契约——
 * 选项行必须携带 partner（BusinessPartner）引用，前端用 partner.id 作为 POST.supplierId 提交值（禁 raw Supplier.id）。
 */
describe('GET /api/suppliers — 供应商 selector 契约', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.supplier = {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'sup-1',
          code: 'S001',
          name: '上海电机厂',
          partner: { id: 'bp-10', code: 'BP001', name: '上海电机厂', uscc: '91310000', type: 'SUPPLIER' },
        },
      ]),
    };
  });

  it('返回 supplier 行含 partner.id（BusinessPartner.id）——前端 selector 的唯一合法提交值', async () => {
    const res = await GET(new NextRequest('http://localhost/api/suppliers?pageSize=100'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].partner.id).toBe('bp-10');
    expect(body.data[0].partner.type).toBe('SUPPLIER');
  });

  it('supplier:view 权限由 requirePermission 强制（无权限 → 403）', async () => {
    const { requirePermission } = await import('@/lib/api-helpers');
    (requirePermission as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Response(JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message: 'no permission' } }), { status: 403 }),
    );
    const res = await GET(new NextRequest('http://localhost/api/suppliers'));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/suppliers — 供应商建档边界（防把客户当供应商）', () => {
  beforeEach(() => vi.clearAllMocks());

  function makeRequest(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/suppliers', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('partner type=CUSTOMER → 409（不能给纯客户建供应商档案）', async () => {
    mockPrisma.businessPartner = { findFirst: vi.fn().mockResolvedValue({ id: 'bp-9', type: 'CUSTOMER' }) };
    const res = await POST(makeRequest({ code: 'S100', name: '客户误建', partnerId: 'bp-9' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT');
  });

  it('partner 不存在 → 409 NOT_FOUND（failConflict 语义）', async () => {
    mockPrisma.businessPartner = { findFirst: vi.fn().mockResolvedValue(null) };
    const res = await POST(makeRequest({ code: 'S100', name: '不存在', partnerId: 'bp-x' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
