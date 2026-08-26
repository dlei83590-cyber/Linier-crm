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
      .mockResolvedValueOnce({ id: 'item-1', deletedAt: null })
      .mockResolvedValueOnce({ _count: { priceListItems: 0, projectProducts: 0 } });
    const res = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: 'item-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deleted).toBe(true);
  });

  it('存在未删除的有效引用（projectProducts>0）→ 409 CONFLICT', async () => {
    findFirstMock
      .mockResolvedValueOnce({ id: 'item-1', deletedAt: null })
      .mockResolvedValueOnce({ _count: { priceListItems: 0, projectProducts: 1 } });
    const res = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: 'item-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT');
  });

  it('物料不存在 → 404 NOT_FOUND', async () => {
    findFirstMock.mockResolvedValue(null);
    const res = await DELETE(makeDeleteRequest('item-x'), { params: Promise.resolve({ id: 'item-x' }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
