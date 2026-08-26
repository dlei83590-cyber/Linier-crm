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

import { DELETE } from '@/app/api/unit-of-measures/[id]/route';

describe('DELETE /api/unit-of-measures/:id — 引用检查仅统计未删除（deletedAt:null）引用', () => {
  let findFirstMock: ReturnType<typeof vi.fn>;
  let updateMock: ReturnType<typeof vi.fn>;

  /** 构造带 _count 的计量单位；counts 只统计未软删除的引用 */
  function uomWithCounts(counts: Record<string, number>) {
    return {
      id: 'uom-1',
      _count: {
        items: counts.items ?? 0,
        stockItems: counts.stockItems ?? 0,
        purchaseItems: counts.purchaseItems ?? 0,
        salesItems: counts.salesItems ?? 0,
        fromConversions: counts.fromConversions ?? 0,
        toConversions: counts.toConversions ?? 0,
        quotationLines: counts.quotationLines ?? 0,
        salesOrderLines: counts.salesOrderLines ?? 0,
        deliveryLines: counts.deliveryLines ?? 0,
        invoiceLines: counts.invoiceLines ?? 0,
        creditDebitNoteLines: counts.creditDebitNoteLines ?? 0,
        purchaseRequisitionLines: counts.purchaseRequisitionLines ?? 0,
        purchaseOrderLines: counts.purchaseOrderLines ?? 0,
        purchaseReceiptLines: counts.purchaseReceiptLines ?? 0,
        warehouseReceiptLines: counts.warehouseReceiptLines ?? 0,
        purchaseReturnLines: counts.purchaseReturnLines ?? 0,
        inventoryMovements: counts.inventoryMovements ?? 0,
        transferLines: counts.transferLines ?? 0,
        adjustmentLines: counts.adjustmentLines ?? 0,
        conversionLines: counts.conversionLines ?? 0,
        conversionBaseUoms: counts.conversionBaseUoms ?? 0,
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock = vi.fn();
    updateMock = vi.fn().mockResolvedValue({ id: 'uom-1', deletedAt: new Date() });
    mockPrisma.unitOfMeasure = { findFirst: findFirstMock, update: updateMock };
  });

  it('无任何引用 → 200 软删除', async () => {
    findFirstMock.mockResolvedValue(uomWithCounts({}));
    const res = await DELETE(new NextRequest('http://localhost/api/unit-of-measures/uom-1', { method: 'DELETE' }), { params: Promise.resolve({ id: 'uom-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deleted).toBe(true);
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'uom-1' } }));
  });

  it('存在未删除的有效引用（items>0）→ 409 CONFLICT', async () => {
    findFirstMock.mockResolvedValue(uomWithCounts({ items: 1 }));
    const res = await DELETE(new NextRequest('http://localhost/api/unit-of-measures/uom-1', { method: 'DELETE' }), { params: Promise.resolve({ id: 'uom-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT');
  });

  it('计量单位不存在 → 404 NOT_FOUND', async () => {
    findFirstMock.mockResolvedValue(null);
    const res = await DELETE(new NextRequest('http://localhost/api/unit-of-measures/uom-x', { method: 'DELETE' }), { params: Promise.resolve({ id: 'uom-x' }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
