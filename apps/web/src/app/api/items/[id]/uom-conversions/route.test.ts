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

import { GET } from '@/app/api/items/[id]/uom-conversions/route';

describe('GET /api/items/:id/uom-conversions — 原料单位换算（J 线）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.item = { findFirst: vi.fn().mockResolvedValue({ id: 'item-1' }) };
    mockPrisma.uomConversion = {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([
        { id: 'c-1', factor: '1000', fromUom: { code: 'KG', name: '千克' }, toUom: { code: 'G', name: '克' } },
      ]),
    };
  });

  it('返回换算列表（from→to × factor）', async () => {
    const res = await GET(new NextRequest('http://localhost/api/items/item-1/uom-conversions'), { params: Promise.resolve({ id: 'item-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].factor).toBe('1000');
    expect(body.data[0].fromUom.code).toBe('KG');
  });

  it('物料不存在 → 404', async () => {
    mockPrisma.item = { findFirst: vi.fn().mockResolvedValue(null) };
    const res = await GET(new NextRequest('http://localhost/api/items/item-x/uom-conversions'), { params: Promise.resolve({ id: 'item-x' }) });
    expect(res.status).toBe(404);
  });

  it('无换算规则 → 空数组', async () => {
    mockPrisma.uomConversion = { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) };
    const res = await GET(new NextRequest('http://localhost/api/items/item-1/uom-conversions'), { params: Promise.resolve({ id: 'item-1' }) });
    const body = await res.json();
    expect(body.data).toEqual([]);
  });
});
