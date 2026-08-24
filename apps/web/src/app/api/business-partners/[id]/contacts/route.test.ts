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

import { POST } from '@/app/api/business-partners/[id]/contacts/route';

/** 2A contacts POST：主联系人唯一性（事务清除其他 primary + partial unique 兜底）+ 并发 P2002 → 409 */

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/business-partners/bp-1/contacts', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

type TxMock = {
  businessPartner: { findFirst: ReturnType<typeof vi.fn> };
  partnerContact: { updateMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
};

function makeTx(): TxMock {
  return {
    businessPartner: { findFirst: vi.fn().mockResolvedValue({ id: 'bp-1' }) },
    partnerContact: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: 'c-1', partnerId: 'bp-1', name: '张三', isPrimary: true }),
    },
  };
}

describe('POST /api/business-partners/:id/contacts — 主联系人唯一性', () => {
  beforeEach(() => vi.clearAllMocks());

  it('isPrimary=true → 同事务清除其他 active primary（updateMany）再 create', async () => {
    const tx = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest({ name: '张三', isPrimary: true }), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(res.status).toBe(201);
    const updateArgs = (tx.partnerContact.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateArgs.where).toMatchObject({ partnerId: 'bp-1', isPrimary: true, isActive: true, deletedAt: null });
    expect(updateArgs.data.isPrimary).toBe(false);
  });

  it('非 primary → 不调用 updateMany 清除', async () => {
    const tx = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    await POST(makeRequest({ name: '李四' }), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(tx.partnerContact.updateMany as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('并发设置主联系人 → P2002 → 409 CONTACT_PRIMARY_CONFLICT', async () => {
    const tx = makeTx();
    (tx.partnerContact.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('duplicate key'), { code: 'P2002' }),
    );
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest({ name: '王五', isPrimary: true }), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONTACT_PRIMARY_CONFLICT');
  });
});
