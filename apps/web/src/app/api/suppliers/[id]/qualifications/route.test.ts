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

import { POST, GET } from '@/app/api/suppliers/[id]/qualifications/route';

/**
 * FRT-02 契约测试：SupplierProfile「资质证书」区块依赖的
 * POST/GET /api/suppliers/:id/qualifications。
 */
describe('POST /api/suppliers/:id/qualifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.supplier = { findFirst: vi.fn().mockResolvedValue({ id: 'sup-1' }) };
    mockPrisma.supplierQualification = { create: vi.fn().mockResolvedValue({ id: 'q-1', qualType: 'ISO9001', qualName: 'ISO9001:2015', status: 'VALID' }) };
  });

  it('新增资质成功（supplierId 绑定 + status 默认 VALID）', async () => {
    const req = new NextRequest('http://localhost/api/suppliers/sup-1/qualifications', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ qualType: 'ISO9001', qualName: 'ISO9001:2015', certNo: 'C-001' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'sup-1' }) });
    expect(res.status).toBe(201);
    const createArgs = (mockPrisma.supplierQualification.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArgs.data.supplierId).toBe('sup-1');
    expect(createArgs.data.status).toBe('VALID');
  });

  it('缺少 qualName → 400（校验失败）', async () => {
    const req = new NextRequest('http://localhost/api/suppliers/sup-1/qualifications', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ qualType: 'ISO9001' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'sup-1' }) });
    expect(res.status).toBe(400);
    expect(mockPrisma.supplierQualification.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/suppliers/:id/qualifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.supplier = { findFirst: vi.fn().mockResolvedValue({ id: 'sup-1' }) };
    mockPrisma.supplierQualification = {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([{ id: 'q-1', qualType: 'ISO9001', qualName: 'ISO9001:2015', status: 'VALID' }]),
    };
  });

  it('返回资质列表', async () => {
    const res = await GET(new NextRequest('http://localhost/api/suppliers/sup-1/qualifications?pageSize=50'), { params: Promise.resolve({ id: 'sup-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].qualName).toBe('ISO9001:2015');
  });
});
