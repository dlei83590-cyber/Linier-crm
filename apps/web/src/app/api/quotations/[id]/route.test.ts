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

import { GET } from '@/app/api/quotations/[id]/route';

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/quotations/qt-1', { headers: { authorization: 'Bearer test-token' } });
}

const baseQuotation = {
  id: 'qt-1',
  code: 'QT-2026-0001',
  customerId: 'c-1',
  status: 'ACCEPTED',
  quoteDate: new Date('2026-01-01T00:00:00.000Z'),
  validUntil: null,
  currency: 'CNY',
  subtotal: '100',
  taxAmount: '13',
  totalAmount: '113',
  remark: null,
  salesOrderId: null,
  convertedAt: null,
  isActive: true,
  createdById: null,
  updatedById: null,
  approvedById: null,
  approvalStatus: 'APPROVED',
  version: 1,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('GET /api/quotations/:id — FRT-06 已转订单链接投影', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.quotation = { findFirst: vi.fn().mockResolvedValue(null) };
  });

  it('未转换：salesOrder 为 null，前端不展示转换链接', async () => {
    mockPrisma.quotation = {
      findFirst: vi.fn().mockResolvedValue({ ...baseQuotation, salesOrder: null }),
    };
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'qt-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe('qt-1');
    expect(body.data.salesOrder).toBeNull();
  });

  it('已转换：GET 详情携带 salesOrder 投影（id/code/status），报价详情可直链销售订单', async () => {
    mockPrisma.quotation = {
      findFirst: vi.fn().mockResolvedValue({
        ...baseQuotation,
        salesOrderId: 'so-1',
        convertedAt: new Date('2026-01-02T00:00:00.000Z'),
        salesOrder: { id: 'so-1', code: 'SO-2026-0001', status: 'DRAFT' },
      }),
    };
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'qt-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.salesOrderId).toBe('so-1');
    expect(body.data.salesOrder).toEqual({ id: 'so-1', code: 'SO-2026-0001', status: 'DRAFT' });
    // 断言 prisma include 携带 salesOrder 投影（防止回归删除）
    const findFirst = (mockPrisma.quotation as { findFirst: ReturnType<typeof vi.fn> }).findFirst;
    const include = findFirst.mock.calls[0][0] as { include: { salesOrder: unknown } };
    expect(include.include.salesOrder).toEqual({ select: { id: true, code: true, status: true } });
  });

  it('报价单不存在 → 404', async () => {
    mockPrisma.quotation = { findFirst: vi.fn().mockResolvedValue(null) };
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'qt-x' }) });
    expect(res.status).toBe(404);
  });

  it('CC-05 打印投影：详情携带客户联系/地址 + 销售负责人 + 行单位/规格（additive 只读，防回归删除）', async () => {
    mockPrisma.quotation = {
      findFirst: vi.fn().mockResolvedValue({
        ...baseQuotation,
        customer: {
          id: 'c-1',
          code: 'C001',
          name: '客户A',
          fullName: '客户A有限公司',
          contactPerson: '王经理',
          phone: '13800000000',
          email: 'wang@example.com',
          address: '上海市浦东新区某路 100 号',
          customerOwnerships: [{ owner: { id: 'u-9', name: '张销售', email: 'zhang@example.com' } }],
        },
        lines: [
          {
            id: 'l-1',
            quotationId: 'qt-1',
            lineNo: 10,
            itemId: 'i-1',
            description: '线性模组',
            quantity: '100',
            unitPrice: '1234.568',
            lineAmount: '123456.8',
            taxAmount: '16049.38',
            totalAmount: '139506.18',
            version: 1,
            item: { id: 'i-1', code: 'FG-001', name: '线性模组', model: 'SMH45A', spec: '行程 450mm' },
            uom: { id: 'uom-1', code: 'PC', name: '件', symbol: '件' },
          },
        ],
      }),
    };
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'qt-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    // 响应事实：客户联系/地址 + 销售负责人（归属 SSOT）随详情返回
    expect(body.data.customer.contactPerson).toBe('王经理');
    expect(body.data.customer.address).toContain('上海市浦东新区');
    expect(body.data.customer.customerOwnerships[0].owner.name).toBe('张销售');
    // 响应事实：行单位 + 规格
    expect(body.data.lines[0].uom.symbol).toBe('件');
    expect(body.data.lines[0].item.spec).toBe('行程 450mm');

    // 防回归：include 结构携带打印投影（customer select + lines.uom）
    const findFirst = (mockPrisma.quotation as { findFirst: ReturnType<typeof vi.fn> }).findFirst;
    const include = findFirst.mock.calls[0][0] as {
      include: {
        customer: { select: Record<string, unknown> };
        lines: { include: { uom: unknown; item: { select: Record<string, unknown> } } };
      };
    };
    expect(include.include.customer.select.fullName).toBe(true);
    expect(include.include.customer.select.contactPerson).toBe(true);
    expect(include.include.customer.select.address).toBe(true);
    expect(include.include.customer.select.customerOwnerships).toBeDefined();
    expect(include.include.lines.include.uom).toEqual({
      select: { id: true, code: true, name: true, symbol: true },
    });
    expect(include.include.lines.include.item.select.spec).toBe(true);
  });
});
