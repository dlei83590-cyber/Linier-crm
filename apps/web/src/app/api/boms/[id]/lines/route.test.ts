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

import { POST } from '@/app/api/boms/[id]/lines/route';

const bomRow = { id: 'bom-1', bomNo: 'BOM-FG-1', finishedItemId: 'fg-1', bomVersion: 1, status: 'DRAFT', isDefault: false, version: 1, deletedAt: null };
const compRow = { id: 'rm-1', code: 'RM-1', name: '原料一', stockUomId: 'uom-1', deletedAt: null };

type TxMock = {
  itemBom: { findFirst: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  item: { findFirst: ReturnType<typeof vi.fn> };
  itemBomLine: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
};

function makeTx(overrides: Partial<TxMock> = {}): TxMock {
  return {
    itemBom: {
      findFirst: vi.fn().mockResolvedValue(bomRow),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    item: { findFirst: vi.fn().mockResolvedValue(compRow) },
    itemBomLine: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'line-1', bomId: 'bom-1', componentItemId: 'rm-1', componentUomId: 'uom-1',
        qtyPerFinishedUnit: { toFixed: () => '2.000000' },
      }),
    },
    ...overrides,
  };
}

function makeRequest(body: unknown, method = 'POST'): NextRequest {
  return new NextRequest('http://localhost/api/boms/bom-1/lines', {
    method,
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function postLine(body: unknown) {
  return POST(makeRequest(body), { params: Promise.resolve({ id: 'bom-1' }) });
}

describe('POST /api/boms/:id/lines — 增加配方行（产品档案 MVP）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(makeTx()));
  });

  it('DRAFT 配方增加原料行成功（201）', async () => {
    const tx = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await postLine({ version: 1, componentItemId: 'rm-1', componentUomId: 'uom-1', qtyPerFinishedUnit: 2 });
    expect(res.status).toBe(201);
    expect(tx.itemBom.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ version: 1 }) }));
    expect(tx.itemBomLine.create).toHaveBeenCalledTimes(1);
  });

  it('配方不存在 → 404 BOM_NOT_FOUND', async () => {
    const tx = makeTx({ itemBom: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn() } });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await postLine({ version: 1, componentItemId: 'rm-1', componentUomId: 'uom-1', qtyPerFinishedUnit: 2 });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('BOM_NOT_FOUND');
  });

  it('非 DRAFT（ACTIVE）→ 409 BOM_INVALID_STATE', async () => {
    const tx = makeTx({ itemBom: { findFirst: vi.fn().mockResolvedValue({ ...bomRow, status: 'ACTIVE' }), updateMany: vi.fn() } });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await postLine({ version: 1, componentItemId: 'rm-1', componentUomId: 'uom-1', qtyPerFinishedUnit: 2 });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('BOM_INVALID_STATE');
  });

  it('版本冲突 → 409 VERSION_CONFLICT（CAS 未命中）', async () => {
    const tx = makeTx({ itemBom: { findFirst: vi.fn().mockResolvedValue(bomRow), updateMany: vi.fn().mockResolvedValue({ count: 0 }) } });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await postLine({ version: 1, componentItemId: 'rm-1', componentUomId: 'uom-1', qtyPerFinishedUnit: 2 });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('VERSION_CONFLICT');
  });

  it('单位红线：componentUomId != 原料库存单位 → 409 BOM_LINE_INVALID', async () => {
    const tx = makeTx({ item: { findFirst: vi.fn().mockResolvedValue({ ...compRow, stockUomId: 'uom-9' }) } });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await postLine({ version: 1, componentItemId: 'rm-1', componentUomId: 'uom-1', qtyPerFinishedUnit: 2 });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('BOM_LINE_INVALID');
  });

  it('同一配方内原料重复 → 409 BOM_COMPONENT_DUPLICATE', async () => {
    const tx = makeTx({ itemBomLine: { findFirst: vi.fn().mockResolvedValue({ id: 'line-x' }), create: vi.fn() } });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await postLine({ version: 1, componentItemId: 'rm-1', componentUomId: 'uom-1', qtyPerFinishedUnit: 2 });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('BOM_COMPONENT_DUPLICATE');
  });
});
