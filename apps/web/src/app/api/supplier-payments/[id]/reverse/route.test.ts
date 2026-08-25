import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const {
  mockPrisma,
  mockRequirePermission,
  mockReverseSupplierPayment,
  mockWriteSupplierPaymentReversedEvent,
} = vi.hoisted(() => ({
  mockPrisma: {} as Record<string, unknown>,
  mockRequirePermission: vi.fn(),
  mockReverseSupplierPayment: vi.fn(),
  mockWriteSupplierPaymentReversedEvent: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/api-helpers', () => ({
  authenticate: vi.fn().mockResolvedValue({ id: 'u-2', email: 'b@c.d', roles: ['SUPER_ADMIN'] }),
  requirePermission: mockRequirePermission,
  requestMeta: vi.fn().mockReturnValue({ requestId: 'req-1' }),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  requestLog: vi.fn(),
}));
vi.mock('@/lib/supplier-payment/reverse-helper', () => ({
  reverseSupplierPayment: mockReverseSupplierPayment,
}));
vi.mock('@/lib/supplier-payment/events', () => ({
  writeSupplierPaymentReversedEvent: mockWriteSupplierPaymentReversedEvent,
}));

import { POST } from '@/app/api/supplier-payments/[id]/reverse/route';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/supplier-payments/pay-1/reverse', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function setupTx() {
  const tx = {
    supplierPayment: {
      findFirst: vi.fn().mockResolvedValue({ id: 'pay-1', code: 'PAY-2026-0001', supplierId: 'sup-1' }),
    },
  };
  mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
  return tx;
}

describe('POST /api/supplier-payments/:id/reverse — 付款单整体冲销（Red Reversal，FRT-09 AP payment reverse）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockReturnValue(null);
    mockWriteSupplierPaymentReversedEvent.mockResolvedValue(undefined);
    mockPrisma.$transaction = vi.fn();
  });

  it('无 supplier-payment:edit 权限 → 403（不触达 DB / helper）', async () => {
    mockRequirePermission.mockReturnValue(
      NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: 'no' } }, { status: 403 }),
    );
    const res = await POST(makeRequest({ reason: '开票有误', version: 3 }), {
      params: Promise.resolve({ id: 'pay-1' }),
    });
    expect(res.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockReverseSupplierPayment).not.toHaveBeenCalled();
  });

  it('校验失败（缺 version）→ 400，不触达 helper', async () => {
    const res = await POST(makeRequest({ reason: '开票有误' }), {
      params: Promise.resolve({ id: 'pay-1' }),
    });
    expect(res.status).toBe(400);
    expect(mockReverseSupplierPayment).not.toHaveBeenCalled();
  });

  it('已核销付款单整体冲销 → 200，helper 收到 paymentId/reason/version/actorId，写冲销事件', async () => {
    const tx = setupTx();
    mockReverseSupplierPayment.mockResolvedValue({ ok: true, reversedAllocations: 2 });
    const res = await POST(makeRequest({ reason: '发票金额有误，整体冲销', version: 3 }), {
      params: Promise.resolve({ id: 'pay-1' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ id: 'pay-1', reversed: true, reversedAllocations: 2 });
    expect(mockReverseSupplierPayment).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ paymentId: 'pay-1', reason: '发票金额有误，整体冲销', version: 3, actorId: 'u-2' }),
    );
    expect(mockWriteSupplierPaymentReversedEvent).toHaveBeenCalled();
  });

  it('VOIDED（已作废）→ 409 CONFLICT', async () => {
    setupTx();
    mockReverseSupplierPayment.mockResolvedValue({
      ok: false,
      code: 'VOIDED',
      message: '付款单已作废（未核销场景走 void；已核销不可 void）',
      httpStatus: 409,
    });
    const res = await POST(makeRequest({ reason: '作废处理', version: 2 }), {
      params: Promise.resolve({ id: 'pay-1' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT');
  });

  it('ALREADY_REVERSED（幂等拒绝）→ 409 CONFLICT', async () => {
    setupTx();
    mockReverseSupplierPayment.mockResolvedValue({
      ok: false,
      code: 'ALREADY_REVERSED',
      message: '付款单已整体冲销，幂等拒绝',
      httpStatus: 409,
    });
    const res = await POST(makeRequest({ reason: '重复冲销', version: 2 }), {
      params: Promise.resolve({ id: 'pay-1' }),
    });
    expect(res.status).toBe(409);
  });

  it('MAKER_CHECKER（冲销人=创建人）→ 409 CONFLICT', async () => {
    setupTx();
    mockReverseSupplierPayment.mockResolvedValue({
      ok: false,
      code: 'MAKER_CHECKER',
      message: '冲销人不能是付款单创建人（maker-checker）',
      httpStatus: 409,
    });
    const res = await POST(makeRequest({ reason: '纠错', version: 2 }), {
      params: Promise.resolve({ id: 'pay-1' }),
    });
    expect(res.status).toBe(409);
    expect(mockWriteSupplierPaymentReversedEvent).not.toHaveBeenCalled();
  });

  it('VERSION_CONFLICT（CAS 冲突）→ 409 VERSION_CONFLICT（前端明确提示刷新）', async () => {
    setupTx();
    mockReverseSupplierPayment.mockResolvedValue({
      ok: false,
      code: 'VERSION_CONFLICT',
      message: '版本冲突，请刷新后重试',
      httpStatus: 409,
    });
    const res = await POST(makeRequest({ reason: '纠错', version: 1 }), {
      params: Promise.resolve({ id: 'pay-1' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('VERSION_CONFLICT');
  });

  it('NO_ALLOCATIONS（无未反转核销）→ 409 CONFLICT（未核销场景走 void）', async () => {
    setupTx();
    mockReverseSupplierPayment.mockResolvedValue({
      ok: false,
      code: 'NO_ALLOCATIONS',
      message: '该付款单无未反转核销记录（未核销场景请用作废 void）',
      httpStatus: 409,
    });
    const res = await POST(makeRequest({ reason: '纠错', version: 2 }), {
      params: Promise.resolve({ id: 'pay-1' }),
    });
    expect(res.status).toBe(409);
  });
});
