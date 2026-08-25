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

import { GET } from '@/app/api/sales-orders/[id]/supplier-recommendations/route';

const ruleMock = () =>
  mockPrisma.customerSupplierRatingRule as { findFirst: ReturnType<typeof vi.fn> };

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/sales-orders/so-1/supplier-recommendations', { headers: { authorization: 'Bearer test-token' } });
}

/** 默认数据：客户等级 VIP + 三条 SupplierItem（甲 AA 优选、乙 B、丙无 PartnerCredit 评级） */
function setupDefault() {
  mockPrisma.salesOrder = { findFirst: vi.fn().mockResolvedValue({ id: 'so-1', customerId: 'c-1', customer: { id: 'c-1', customerLevel: 'VIP' } }) };
  mockPrisma.customerSupplierRatingRule = {
    findFirst: vi.fn().mockResolvedValue({ customerLevel: 'VIP', minimumSupplierRating: 'A' }),
  };
  mockPrisma.salesOrderLine = {
    findMany: vi.fn().mockResolvedValue([{ itemId: 'fg-1' }, { itemId: 'fg-2' }]),
  };
  mockPrisma.supplierItem = {
    findMany: vi.fn().mockResolvedValue([
      { id: 'si-1', itemId: 'fg-1', isPreferred: true, purchasePrice: '100', supplier: { id: 'sup-1', code: 'S001', name: '甲供应商', creditRating: 'AA', settlementTerms: '30 天', isActive: true, partnerCredit: { rating: 'AA' } } },
      { id: 'si-2', itemId: 'fg-2', isPreferred: false, purchasePrice: '200', supplier: { id: 'sup-1', code: 'S001', name: '甲供应商', creditRating: 'AA', settlementTerms: '30 天', isActive: true, partnerCredit: { rating: 'AA' } } },
      { id: 'si-3', itemId: 'fg-1', isPreferred: false, purchasePrice: '90', supplier: { id: 'sup-2', code: 'S002', name: '乙供应商', creditRating: 'B', settlementTerms: null, isActive: true, partnerCredit: { rating: 'B' } } },
      { id: 'si-4', itemId: 'fg-2', isPreferred: false, purchasePrice: '80', supplier: { id: 'sup-3', code: 'S003', name: '丙供应商', creditRating: 'AAA', settlementTerms: null, isActive: true, partnerCredit: null } },
    ]),
  };
}

describe('GET /api/sales-orders/:id/supplier-recommendations — 推荐供应商（cc-06 客户等级→供应商评级匹配）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefault();
  });

  it('规则命中：仅返回评级 ≥ 门槛的供应商，优选优先 + 评级降序', async () => {
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'so-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    // 甲 AA（优选）与乙 B 满足 ≥ A；丙无 PartnerCredit 评级 → 不满足门槛被过滤
    expect(body.data.rows.length).toBe(2);
    expect(body.data.rows[0].supplierName).toBe('甲供应商'); // 优选优先
    expect(body.data.rows[0].supplierRating).toBe('AA');
    expect(body.data.rows[1].supplierName).toBe('乙供应商');
    expect(body.data.ruleApplied).toBe(true);
    expect(body.data.minimumSupplierRating).toBe('A');
    expect(body.data.customerLevel).toBe('VIP');
    expect(body.data.basis).toContain('客户等级');
    expect(body.data.basis).toContain('≥ A');
  });

  it('规则命中但无合格供应商 → 空 rows（仍返回 basis/ruleApplied）', async () => {
    mockPrisma.customerSupplierRatingRule = { findFirst: vi.fn().mockResolvedValue({ customerLevel: 'VIP', minimumSupplierRating: 'AAA' }) };
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'so-1' }) });
    const body = await res.json();
    expect(body.data.rows).toEqual([]);
    expect(body.data.ruleApplied).toBe(true);
    expect(body.data.minimumSupplierRating).toBe('AAA');
  });

  it('无规则默认：客户等级未配置规则 → 展示全部供应商（不过滤）', async () => {
    mockPrisma.customerSupplierRatingRule = { findFirst: vi.fn().mockResolvedValue(null) };
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'so-1' }) });
    const body = await res.json();
    expect(body.data.rows.length).toBe(3); // 甲/乙/丙全部
    expect(body.data.ruleApplied).toBe(false);
    expect(body.data.minimumSupplierRating).toBeNull();
    expect(body.data.basis).toContain('未配置评级规则');
  });

  it('客户未设置等级 → 无门槛，展示全部（basis 说明）', async () => {
    mockPrisma.salesOrder = { findFirst: vi.fn().mockResolvedValue({ id: 'so-1', customerId: 'c-1', customer: { id: 'c-1', customerLevel: null } }) };
    ruleMock().findFirst = vi.fn();
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'so-1' }) });
    const body = await res.json();
    expect(body.data.rows.length).toBe(3);
    expect(body.data.ruleApplied).toBe(false);
    expect(body.data.customerLevel).toBeNull();
    expect(body.data.basis).toContain('客户未设置等级');
    expect(ruleMock().findFirst).not.toHaveBeenCalled();
  });

  it('无 SupplierItem → rows 空数组（响应结构不变）', async () => {
    mockPrisma.supplierItem = { findMany: vi.fn().mockResolvedValue([]) };
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'so-1' }) });
    const body = await res.json();
    expect(body.data.rows).toEqual([]);
    expect(body.data.ruleApplied).toBe(true);
  });

  it('订单不存在 → 404', async () => {
    mockPrisma.salesOrder = { findFirst: vi.fn().mockResolvedValue(null) };
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'so-x' }) });
    expect(res.status).toBe(404);
  });

  it('权限不足 → requirePermission 拒绝（403 语义由 helper 返回）', async () => {
    const { requirePermission } = await import('@/lib/api-helpers');
    (requirePermission as ReturnType<typeof vi.fn>).mockReturnValueOnce(new Response('denied', { status: 403 }));
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'so-1' }) });
    expect(res.status).toBe(403);
  });
});
