import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

const {
  mockPrisma,
  mockRequirePermission,
  mockCreateInvoiceRevision,
  mockCreateInvoiceSnapshot,
  mockLatestInvoiceRevisionNo,
  mockPublishInvoiceEvent,
} = vi.hoisted(() => ({
  mockPrisma: {} as Record<string, unknown>,
  mockRequirePermission: vi.fn(),
  mockCreateInvoiceRevision: vi.fn(),
  mockCreateInvoiceSnapshot: vi.fn(),
  mockLatestInvoiceRevisionNo: vi.fn(),
  mockPublishInvoiceEvent: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/api-helpers', () => ({
  authenticate: vi.fn().mockResolvedValue({ id: 'u-1', email: 'a@b.c', roles: ['SUPER_ADMIN'] }),
  requirePermission: mockRequirePermission,
  requestMeta: vi.fn().mockReturnValue({ requestId: 'req-1' }),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  requestLog: vi.fn(),
}));
vi.mock('@/lib/invoice/helpers', () => ({
  createInvoiceRevision: mockCreateInvoiceRevision,
  createInvoiceSnapshot: mockCreateInvoiceSnapshot,
  latestInvoiceRevisionNo: mockLatestInvoiceRevisionNo,
}));
vi.mock('@/lib/invoice/events', () => ({
  publishInvoiceEvent: mockPublishInvoiceEvent,
}));

import { POST } from '@/app/api/invoices/[id]/red-invoice/route';

const line = {
  id: 'line-1',
  sourceDeliveryLineId: 'dl-line-1',
  lineNo: 1,
  itemId: 'item-1',
  description: '测试物料',
  quantity: new Prisma.Decimal('2'),
  uomId: 'uom-1',
  priceSnapshotId: null,
  unitPrice: new Prisma.Decimal('50'),
  discountRate: new Prisma.Decimal('0'),
  lineAmount: new Prisma.Decimal('100'),
  taxAmount: new Prisma.Decimal('13'),
  totalAmount: new Prisma.Decimal('113'),
  createdById: 'u-1',
};

function makeOriginal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'inv-1',
    code: 'INV-2026-000001',
    status: 'ISSUED',
    redLetter: false,
    deliveryId: 'del-1',
    salesOrderId: 'so-1',
    customerId: 'c-1',
    currency: 'CNY',
    taxProfileId: 'tp-1',
    paymentTerm: 'NET30',
    subtotal: '100.0000',
    taxAmount: '13.0000',
    invoiceTotal: '113.0000',
    paidAmount: '0',
    balanceAmount: '113.0000',
    remark: '备注',
    lines: [line],
    ...overrides,
  };
}

function makeTx(overrides: Record<string, unknown> = {}) {
  const red = { id: 'red-1', deliveryId: 'del-1', salesOrderId: 'so-1', customerId: 'c-1', currency: 'CNY', invoiceTotal: '113.0000' };
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'inv-1' }]),
    invoice: {
      findFirst: vi.fn().mockResolvedValue(makeOriginal()),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue(red),
    },
    invoiceLine: { create: vi.fn().mockResolvedValue({ id: 'red-line-1' }) },
    ...overrides,
  } as unknown as Prisma.TransactionClient;
}

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/invoices/inv-1/red-invoice', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
}

describe('POST /api/invoices/:id/red-invoice — 从 ISSUED 蓝票创建红字草稿（FRT-09 红冲入口）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockReturnValue(null);
    mockCreateInvoiceRevision.mockResolvedValue(undefined);
    mockCreateInvoiceSnapshot.mockResolvedValue(undefined);
    mockLatestInvoiceRevisionNo.mockResolvedValue(1);
    mockPublishInvoiceEvent.mockResolvedValue(undefined);
    mockPrisma.$transaction = vi.fn();
  });

  it('无 invoice:create 权限 → 403（不触达 DB）', async () => {
    mockRequirePermission.mockReturnValue(
      NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: 'no' } }, { status: 403 }),
    );
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    expect(res.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('ISSUED 蓝票 → 200，创建红字 DRAFT（redLetter=true + redInvoiceRefId=原票）', async () => {
    const tx = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ id: 'red-1', originalInvoiceId: 'inv-1', redLetter: true });
    const createArgs = (tx.invoice.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArgs.data.status).toBe('DRAFT');
    expect(createArgs.data.redLetter).toBe(true);
    expect(createArgs.data.redInvoiceRefId).toBe('inv-1');
    expect(createArgs.data.paidAmount.toString()).toBe('0');
    // Revision + Snapshot 留痕
    expect(mockCreateInvoiceRevision).toHaveBeenCalled();
    expect(mockCreateInvoiceSnapshot).toHaveBeenCalled();
    expect(mockPublishInvoiceEvent).toHaveBeenCalled();
  });

  it('DRAFT 原票 → 409 RED_INVOICE_REF_STATUS_INVALID（仅 ISSUED 可红冲）', async () => {
    const tx = makeTx({ invoice: { findFirst: vi.fn().mockResolvedValue(makeOriginal({ status: 'DRAFT' })), count: vi.fn(), create: vi.fn() } });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('RED_INVOICE_REF_STATUS_INVALID');
    expect(tx.invoice.create).not.toHaveBeenCalled();
  });

  it('红字原票（redLetter）→ 409 RED_INVOICE_REF_STATUS_INVALID（红字禁止再红冲）', async () => {
    const tx = makeTx({ invoice: { findFirst: vi.fn().mockResolvedValue(makeOriginal({ redLetter: true, status: 'ISSUED' })), count: vi.fn(), create: vi.fn() } });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('RED_INVOICE_REF_STATUS_INVALID');
  });

  it('已有全额 ISSUED 红字 → 409 RED_INVOICE_OVERFLOW（防超冲，拒绝第二张）', async () => {
    const tx = makeTx({ invoice: { findFirst: vi.fn().mockResolvedValue(makeOriginal()), count: vi.fn().mockResolvedValue(1), create: vi.fn() } });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('RED_INVOICE_OVERFLOW');
    expect(tx.invoice.create).not.toHaveBeenCalled();
  });
});
