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

import { PATCH, DELETE } from '@/app/api/boms/[id]/lines/[lineId]/route';

const bomRow = { id: 'bom-1', bomNo: 'BOM-FG-1', finishedItemId: 'fg-1', bomVersion: 1, status: 'DRAFT', isDefault: false, version: 1, deletedAt: null };
const lineRow = { id: 'line-1', bomId: 'bom-1', componentItemId: 'rm-1', componentUomId: 'uom-1', qtyPerFinishedUnit: '2.000000', deletedAt: null };

type TxMock = {
  itemBom: { findFirst: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  item: { findFirst: ReturnType<typeof vi.fn> };
  itemBomLine: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
};

function makeTx(overrides: Partial<TxMock> = {}): TxMock {
  return {
    itemBom: {
      findFirst: vi.fn().mockResolvedValue(bomRow),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    item: { findFirst: vi.fn().mockResolvedValue({ id: 'rm-1', stockUomId: 'uom-1' }) },
    itemBomLine: {
      findFirst: vi.fn().mockResolvedValue(lineRow),
      update: vi.fn().mockResolvedValue({ ...lineRow, qtyPerFinishedUnit: '3.000000' }),
      delete: vi.fn().mockResolvedValue(lineRow),
    },
    ...overrides,
  };
}

function makeRequest(body: unknown, method: 'PATCH' | 'DELETE'): NextRequest {
  return new NextRequest('http://localhost/api/boms/bom-1/lines/line-1', {
    method,
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/boms/:id/lines/:lineId — 修改配方行数量（产品档案 MVP）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(makeTx()));
  });

  it('DRAFT 配方修改数量成功（200）', async () => {
    const tx = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await PATCH(makeRequest({ version: 1, qtyPerFinishedUnit: 3 }, 'PATCH'), { params: Promise.resolve({ id: 'bom-1', lineId: 'line-1' }) });
    expect(res.status).toBe(200);
    expect(tx.itemBomLine.update).toHaveBeenCalledTimes(1);
    expect(tx.itemBom.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ version: 1 }) }));
  });

  it('行不存在 → 404 BOM_LINE_NOT_FOUND', async () => {
    const tx = makeTx({ itemBomLine: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn(), delete: vi.fn() } });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await PATCH(makeRequest({ version: 1, qtyPerFinishedUnit: 3 }, 'PATCH'), { params: Promise.resolve({ id: 'bom-1', lineId: 'line-x' }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('BOM_LINE_NOT_FOUND');
  });

  it('非 DRAFT → 409 BOM_INVALID_STATE', async () => {
    const tx = makeTx({ itemBom: { findFirst: vi.fn().mockResolvedValue({ ...bomRow, status: 'ACTIVE' }), updateMany: vi.fn() } });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await PATCH(makeRequest({ version: 1, qtyPerFinishedUnit: 3 }, 'PATCH'), { params: Promise.resolve({ id: 'bom-1', lineId: 'line-1' }) });
    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/boms/:id/lines/:lineId — 删除配方行（产品档案 MVP）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(makeTx()));
  });

  it('DRAFT 配方删除行成功（200 deleted=true）', async () => {
    const tx = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await DELETE(makeRequest({ version: 1 }, 'DELETE'), { params: Promise.resolve({ id: 'bom-1', lineId: 'line-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deleted).toBe(true);
    expect(tx.itemBomLine.delete).toHaveBeenCalledTimes(1);
  });

  it('版本冲突 → 409 VERSION_CONFLICT', async () => {
    const tx = makeTx({ itemBom: { findFirst: vi.fn().mockResolvedValue(bomRow), updateMany: vi.fn().mockResolvedValue({ count: 0 }) } });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await DELETE(makeRequest({ version: 1 }, 'DELETE'), { params: Promise.resolve({ id: 'bom-1', lineId: 'line-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('VERSION_CONFLICT');
  });
});
