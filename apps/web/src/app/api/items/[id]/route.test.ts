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
vi.mock('@/lib/api/cas', () => ({ casUpdate: vi.fn() }));

import { DELETE } from '@/app/api/items/[id]/route';

describe('DELETE /api/items/:id — 引用检查仅统计未删除（deletedAt:null）引用', () => {
  let findFirstMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock = vi.fn();
    mockPrisma.item = { findFirst: findFirstMock };
    // 引用出处（问题二）：价格表/项目样本查询
    mockPrisma.priceListItem = { findMany: vi.fn().mockResolvedValue([{ priceList: { code: 'PL-001' } }]) };
    mockPrisma.projectProduct = { findMany: vi.fn().mockResolvedValue([{ project: { code: 'PJ-001' } }]) };
    mockPrisma.$transaction = vi.fn((fn: (t: Record<string, unknown>) => Promise<unknown>) =>
      fn({
        itemSpecification: { updateMany: vi.fn().mockResolvedValue({}) },
        uomConversion: { updateMany: vi.fn().mockResolvedValue({}) },
        itemCost: { updateMany: vi.fn().mockResolvedValue({}) },
        supplierItem: { updateMany: vi.fn().mockResolvedValue({}) },
        itemRevision: { updateMany: vi.fn().mockResolvedValue({}) },
        itemTag: { updateMany: vi.fn().mockResolvedValue({}) },
        item: { update: vi.fn().mockResolvedValue({}) },
      }),
    );
  });

  function makeDeleteRequest(id = 'item-1'): NextRequest {
    return new NextRequest(`http://localhost/api/items/${id}`, { method: 'DELETE' });
  }

  it('无任何引用 → 200 软删除', async () => {
    findFirstMock
      .mockResolvedValueOnce({ id: 'item-1', code: 'ITM-001', name: '轴承', deletedAt: null })
      .mockResolvedValueOnce({ _count: { priceListItems: 0, projectProducts: 0 } });
    const res = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: 'item-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deleted).toBe(true);
  });

  it('存在未删除的有效引用（projectProducts>0）→ 409 CONFLICT + 引用出处（项目编号）', async () => {
    findFirstMock
      .mockResolvedValueOnce({ id: 'item-1', code: 'ITM-001', name: '轴承', deletedAt: null })
      .mockResolvedValueOnce({ _count: { priceListItems: 0, projectProducts: 1 } });
    const res = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: 'item-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT');
    // 问题二：提示引用出处（实体 + 条数 + 真实项目编号）
    expect(body.error.message).toContain('物料「ITM-001 轴承」已被引用，不能删除：项目产品 1 条（PJ-001）');
    expect(body.error.details.references).toEqual([
      expect.objectContaining({ entity: '项目产品', count: 1, samples: ['PJ-001'] }),
    ]);
  });

  it('存在价格表单价引用（priceListItems>0）→ 409 + 引用出处（价格表编码）', async () => {
    findFirstMock
      .mockResolvedValueOnce({ id: 'item-1', code: 'ITM-001', name: '轴承', deletedAt: null })
      .mockResolvedValueOnce({ _count: { priceListItems: 1, projectProducts: 0 } });
    const res = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: 'item-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.message).toContain('价格表单价 1 条（PL-001）');
  });

  it('物料不存在 → 404 NOT_FOUND', async () => {
    findFirstMock.mockResolvedValue(null);
    const res = await DELETE(makeDeleteRequest('item-x'), { params: Promise.resolve({ id: 'item-x' }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
