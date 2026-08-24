import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: {} as Record<string, unknown> }));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/api-helpers', () => ({
  authenticate: vi.fn().mockResolvedValue({ id: 'u-1', email: 'a@b.c', roles: ['SALES'] }),
  requirePermission: vi.fn().mockReturnValue(null),
  requestMeta: vi.fn().mockReturnValue({ requestId: 'req-1' }),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  requestLog: vi.fn(),
}));

import { POST } from '@/app/api/business-partners/duplicate-check/route';
import { requirePermission } from '@/lib/api-helpers';

type BpRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  isActive: boolean;
  uscc: string | null;
  phone: string | null;
  deletedAt: Date | null;
};

function bp(partial: Partial<BpRow> & { id: string; name: string }): BpRow {
  return { code: 'BP-' + partial.id, type: 'CUSTOMER', isActive: true, uscc: null, phone: null, deletedAt: null, ...partial };
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/business-partners/duplicate-check', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/business-partners/duplicate-check — Phase 2B preflight', () => {
  let bpMock: { findMany: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.clearAllMocks();
    bpMock = { findMany: vi.fn().mockResolvedValue([]) };
    mockPrisma['businessPartner'] = bpMock;
    mockPrisma['partnerContact'] = { findMany: vi.fn().mockResolvedValue([]) };
  });

  it('13. 无 business-partner:create 权限 → 403', async () => {
    (requirePermission as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } }, { status: 403 }),
    );
    const res = await POST(makeRequest({ name: '任意公司' }));
    expect(res.status).toBe(403);
  });

  it('NONE → 200 { duplicateLevel: "NONE", matches: [] }', async () => {
    const res = await POST(makeRequest({ name: '不存在公司', uscc: '91310000MA1K35L88U' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.duplicateLevel).toBe('NONE');
    expect(body.data.matches).toEqual([]);
  });

  it('19. preflight 命中 POTENTIAL 不写业务 Audit（仅 requestLog）', async () => {
    bpMock.findMany = vi.fn().mockResolvedValue([
      bp({ id: 'p1', name: '上海某某科技有限公司' }),
    ]);
    const res = await POST(makeRequest({ name: '上海某某科技有限公司' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.duplicateLevel).toBe('POTENTIAL');
    const writeAuditLog = (await import('@/lib/api-helpers')).writeAuditLog as ReturnType<typeof vi.fn>;
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('EXACT 命中返回 masked matches（不泄漏完整值）', async () => {
    bpMock.findMany = vi.fn().mockResolvedValue([
      bp({ id: 'p1', name: '已有公司', uscc: '91310000MA1K35L88U', phone: '13812340000' }),
    ]);
    const res = await POST(makeRequest({ uscc: '91310000MA1K35L88U' }));
    const body = await res.json();
    expect(body.data.duplicateLevel).toBe('EXACT');
    const m = body.data.matches[0];
    expect(m.phoneMasked).toBe('138****0000');
    expect(m.usccMasked).toBe('9131****88U');
    expect(m.level).toBe('EXACT');
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('13812340000');
    expect(raw).not.toContain('91310000MA1K35L88U');
  });
});
