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

import { GET } from '@/app/api/business-partners/[id]/contacts/[contactId]/relations/route';

/** 2A-3 Scope Hardening：contactId 必须属于 BusinessPartner :id（fail-closed 404） */

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/business-partners/bp-1/contacts/c-1/relations', {
    headers: { authorization: 'Bearer test-token' },
  });
}

describe('relations GET — parent-scope 校验（2A-3）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('正确 partnerId + contactId → 200', async () => {
    mockPrisma.partnerContact = { findFirst: vi.fn().mockResolvedValue({ id: 'c-1', partnerId: 'bp-1' }) };
    mockPrisma.contactRelation = { findMany: vi.fn().mockResolvedValue([]) };
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'bp-1', contactId: 'c-1' }) });
    expect(res.status).toBe(200);
  });

  it('错误 partnerId（contact 不属于该 BusinessPartner）→ 404 fail-closed', async () => {
    mockPrisma.partnerContact = { findFirst: vi.fn().mockResolvedValue(null) };
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'bp-999', contactId: 'c-1' }) });
    expect(res.status).toBe(404);
    expect(mockPrisma.contactRelation).toBeUndefined(); // 不触达子资源查询
  });

  it('错误 contactId → 404（不通过错误 URL 访问他人联系人子资源）', async () => {
    mockPrisma.partnerContact = { findFirst: vi.fn().mockResolvedValue(null) };
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'bp-1', contactId: 'c-999' }) });
    expect(res.status).toBe(404);
  });
});
