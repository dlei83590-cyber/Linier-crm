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

import { GET } from '@/app/api/sales-orders/[id]/material-requirements/route';

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/sales-orders/so-1/material-requirements', { headers: { authorization: 'Bearer test-token' } });
}

describe('GET /api/sales-orders/:id/material-requirements — BOM 预计用料（Q 线）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.salesOrder = { findFirst: vi.fn().mockResolvedValue({ id: 'so-1' }) };
    mockPrisma.salesOrderLine = {
      findMany: vi.fn().mockResolvedValue([
        { itemId: 'fg-1', quantity: '100' },
        { itemId: 'fg-2', quantity: '50' },
      ]),
    };
    mockPrisma.itemBom = {
      findMany: vi.fn().mockResolvedValue([
        { id: 'bom-1', finishedItemId: 'fg-1', isDefault: true },
        { id: 'bom-2', finishedItemId: 'fg-2', isDefault: false },
      ]),
    };
    mockPrisma.itemBomLine = {
      findMany: vi.fn().mockResolvedValue([
        { bomId: 'bom-1', componentItemId: 'rm-1', qtyPerFinishedUnit: '0.5', lossRate: '0.02' },
        { bomId: 'bom-2', componentItemId: 'rm-1', qtyPerFinishedUnit: '1', lossRate: '0' },
      ]),
    };
    mockPrisma.unitOfMeasure = {
      findFirst: vi.fn().mockResolvedValue({ id: 'uom-ton', code: 'TON', name: '吨' }),
    };
    mockPrisma.uomConversion = {
      findMany: vi.fn().mockResolvedValue([
        { itemId: 'rm-1', fromUomId: 'uom-kg', toUomId: 'uom-ton', factor: '0.001' },
      ]),
    };
    mockPrisma.item = {
      findMany: vi.fn().mockResolvedValue([
        { id: 'rm-1', code: 'RM001', name: '钢材', stockUom: { id: 'uom-kg', code: 'KG', name: '千克' } },
      ]),
    };
    mockPrisma.stockProjection = {
      findMany: vi.fn().mockResolvedValue([{ itemId: 'rm-1', onHandQty: '500' }]),
    };
  });

  it('汇总原料需求 = Σ(行数量 × 系数 × (1+lossRate))，含当前库存', async () => {
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'so-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    const row = body.data.find((r: { itemCode: string }) => r.itemCode === 'RM001');
    expect(row).toBeTruthy();
    // 100 × 0.5 × 1.02 + 50 × 1 = 51 + 50 = 101
    expect(row.requiredQty).toBeCloseTo(101, 4);
    expect(row.onHandQty).toBe(500);
    expect(row.uom).toBe('千克');
  });

  it('KG→TON 换算：requiredUom=KG、tonnage=requiredQty × factor、tonnageConvertible=true、reason=null', async () => {
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'so-1' }) });
    const body = await res.json();
    const row = body.data.find((r: { itemCode: string }) => r.itemCode === 'RM001');
    expect(row.requiredUom).toBe('KG');
    // 101 KG × 0.001 = 0.101 TON
    expect(row.tonnage).toBeCloseTo(0.101, 6);
    expect(row.tonnageConvertible).toBe(true);
    expect(row.reason).toBeNull();
  });

  it('反向换算 TON→KG（factor=1000）：tonnage = requiredQty ÷ factor', async () => {
    mockPrisma.uomConversion = {
      findMany: vi.fn().mockResolvedValue([
        { itemId: 'rm-1', fromUomId: 'uom-ton', toUomId: 'uom-kg', factor: '1000' },
      ]),
    };
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'so-1' }) });
    const body = await res.json();
    const row = body.data.find((r: { itemCode: string }) => r.itemCode === 'RM001');
    // 101 KG ÷ 1000 = 0.101 TON
    expect(row.tonnage).toBeCloseTo(0.101, 6);
    expect(row.tonnageConvertible).toBe(true);
    expect(row.reason).toBeNull();
  });

  it('无 UomConversion → 不猜：tonnage=null、tonnageConvertible=false、reason=缺少 KG → TON 换算', async () => {
    mockPrisma.uomConversion = { findMany: vi.fn().mockResolvedValue([]) };
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'so-1' }) });
    const body = await res.json();
    const row = body.data.find((r: { itemCode: string }) => r.itemCode === 'RM001');
    expect(row.tonnage).toBeNull();
    expect(row.tonnageConvertible).toBe(false);
    expect(row.reason).toBe('缺少 KG → TON 换算');
    expect(row.requiredUom).toBe('KG');
  });

  it('无 TON 计量单位 → 全部行 tonnage=null、reason=缺少 TON 计量单位（不查询 UomConversion）', async () => {
    mockPrisma.unitOfMeasure = { findFirst: vi.fn().mockResolvedValue(null) };
    const uomConversionFindMany = vi.fn();
    mockPrisma.uomConversion = { findMany: uomConversionFindMany };
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'so-1' }) });
    const body = await res.json();
    const row = body.data.find((r: { itemCode: string }) => r.itemCode === 'RM001');
    expect(row.tonnage).toBeNull();
    expect(row.tonnageConvertible).toBe(false);
    expect(row.reason).toBe('缺少 TON 计量单位（无法换算）');
    expect(uomConversionFindMany).not.toHaveBeenCalled();
  });

  it('原料无库存计量单位 → reason=原料缺少库存计量单位', async () => {
    mockPrisma.item = {
      findMany: vi.fn().mockResolvedValue([
        { id: 'rm-1', code: 'RM001', name: '钢材', stockUom: null },
      ]),
    };
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'so-1' }) });
    const body = await res.json();
    const row = body.data.find((r: { itemCode: string }) => r.itemCode === 'RM001');
    expect(row.tonnage).toBeNull();
    expect(row.tonnageConvertible).toBe(false);
    expect(row.reason).toBe('原料缺少库存计量单位，无法换算');
  });

  it('订单不存在 → 404', async () => {
    mockPrisma.salesOrder = { findFirst: vi.fn().mockResolvedValue(null) };
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'so-x' }) });
    expect(res.status).toBe(404);
  });

  it('成品无 ACTIVE 配方 → 空数组', async () => {
    mockPrisma.itemBom = { findMany: vi.fn().mockResolvedValue([]) };
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'so-1' }) });
    const body = await res.json();
    expect(body.data).toEqual([]);
  });
});
