import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

// mock 全局依赖（route 级测试：mock prisma + api-helpers，验证 HTTP → handler 全链）
const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: { $transaction: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/api-helpers', () => ({
  authenticate: vi.fn().mockResolvedValue({ id: 'u1', email: 'a@b.c', roles: ['SUPER_ADMIN'] }),
  requirePermission: vi.fn().mockReturnValue(null),
  requestMeta: vi.fn().mockReturnValue({ requestId: 'req-1' }),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  requestLog: vi.fn(),
}));

import { POST } from '@/app/api/gl/journal-entries/manual/route';

/**
 * B 项（审计 P1）：GL 手工凭证创建路由级测试（mock tx）
 * 覆盖：201 创建（DRAFT 不占号）/ 期间校验（CLOSED 拒绝 409）/ 借贷不平衡 409。
 */

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    glAccount: {
      findFirst: vi.fn().mockImplementation((args: any) => Promise.resolve(args.where.code === '9999' ? null : { id: 'acct-' + args.where.code })),
    },
    accountingPeriod: {
      findFirst: vi.fn().mockResolvedValue({ id: 'p1', periodKey: '202608', status: 'OPEN' }),
    },
    glJournalEntry: {
      create: vi.fn().mockImplementation((args: any) => Promise.resolve({ id: 'entry-1', status: 'DRAFT', voucherNo: null, ...args.data, lines: args.data.lines.create })),
    },
    ...overrides,
  } as unknown as Prisma.TransactionClient;
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/gl/journal-entries/manual', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/gl/journal-entries/manual — 路由级（B 项）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('合法请求 → 201 DRAFT（voucherNo=null 不占号）', async () => {
    const tx = makeTx();
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));
    const res = await POST(makeRequest({
      postingDate: '2026-08-20T00:00:00Z',
      summary: '测试凭证',
      lines: [
        { accountCode: '1002', debit: '100.00' },
        { accountCode: '2202', credit: '100.00' },
      ],
    }));
    expect(res.status).toBe(201);
    const created = (tx.glJournalEntry.create as any).mock.calls[0][0].data;
    expect(created.status).toBe('DRAFT');
    expect(created.voucherNo).toBeNull(); // DRAFT 不占号（4D 教训）
    expect(created.voucherType).toBe('GENERAL'); // ADR-0044 默认记
  });

  it('期间已结转 → 409 GL_PERIOD_CLOSED（fail closed）', async () => {
    const tx = makeTx({
      accountingPeriod: { findFirst: vi.fn().mockResolvedValue({ id: 'p1', periodKey: '202608', status: 'CLOSED' }) },
    });
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));
    const res = await POST(makeRequest({
      postingDate: '2026-08-20T00:00:00Z',
      lines: [{ accountCode: '1002', debit: '100.00' }, { accountCode: '2202', credit: '100.00' }],
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('GL_PERIOD_CLOSED');
  });

  it('借贷不平衡 → 409 CONFLICT', async () => {
    const tx = makeTx();
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));
    const res = await POST(makeRequest({
      postingDate: '2026-08-20T00:00:00Z',
      lines: [{ accountCode: '1002', debit: '100.00' }, { accountCode: '2202', credit: '90.00' }],
    }));
    expect(res.status).toBe(409);
  });
});
