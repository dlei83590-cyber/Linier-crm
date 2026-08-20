import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const mockPrisma = { $transaction: vi.fn() };
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/api-helpers', () => ({
  authenticate: vi.fn().mockResolvedValue({ id: 'u-approver', email: 'a@b.c', roles: ['SUPER_ADMIN'] }),
  requirePermission: vi.fn().mockReturnValue(null),
  requestMeta: vi.fn().mockReturnValue({ requestId: 'req-2' }),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  requestLog: vi.fn(),
}));

import { POST } from '@/app/api/gl/journal-entries/[id]/[action]/route';

/**
 * B 项（审计 P1）：GL 手工凭证 post 动作路由级测试
 * 覆盖：POSTED（取号 记202608-0042 + voucherType 沿用）/ maker-checker 409 / 期间 CLOSED 409。
 */

function makeTx(overrides: Record<string, unknown> = {}) {
  const entry = {
    id: 'entry-1',
    status: 'APPROVED',
    sourceType: 'MANUAL',
    voucherType: 'GENERAL' as const,
    createdById: 'u-creator',
    version: 1,
    postingDate: new Date('2026-08-20T00:00:00Z'),
    lines: [
      { debit: new Prisma.Decimal('100.00'), credit: new Prisma.Decimal('0') },
      { debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('100.00') },
    ],
  };
  return {
    glJournalEntry: {
      findFirst: vi.fn().mockResolvedValue(entry),
      update: vi.fn().mockImplementation((args: any) => Promise.resolve({ ...entry, ...args.data, id: 'entry-1', version: 2 })),
    },
    accountingPeriod: {
      findFirst: vi.fn().mockResolvedValue({ id: 'p1', periodKey: '202608', status: 'OPEN' }),
    },
    documentSequence: {
      findFirst: vi.fn().mockResolvedValue({ id: 'seq-jrn', code: 'JRN:202608:GENERAL', docType: 'JOURNAL', prefix: null, nextNo: 42, padLength: 4 }),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({ id: 'seq-jrn', nextNo: 43 }),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'seq-jrn' }]),
    ...overrides,
  } as unknown as Prisma.TransactionClient;
}

function makeRequest(action: string, body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/gl/journal-entries/entry-1/' + action, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/gl/journal-entries/:id/post — 路由级（B 项）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('APPROVED → POSTED：取号 记202608-0042（(期间,凭证字) 连续，ADR-0044）', async () => {
    const tx = makeTx();
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));
    const res = await POST(makeRequest('post', { version: 1 }));
    expect(res.status).toBe(200);
    const updateArgs = (tx.glJournalEntry.update as any).mock.calls[0][0];
    expect(updateArgs.data.status).toBe('POSTED');
    expect(updateArgs.data.voucherNo).toBe('记202608-0042');
  });

  it('maker-checker：过账人 = 创建人 → 409', async () => {
    const tx = makeTx({
      glJournalEntry: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'entry-1', status: 'APPROVED', sourceType: 'MANUAL', createdById: 'u-approver', version: 1,
          postingDate: new Date('2026-08-20T00:00:00Z'), lines: [{ debit: new Prisma.Decimal('10'), credit: new Prisma.Decimal('0') }, { debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('10') }],
        }),
        update: vi.fn(),
      },
    });
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));
    const res = await POST(makeRequest('post', { version: 1 }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.message).toContain('maker-checker');
  });

  it('期间 CLOSED → 409 GL_PERIOD_CLOSED（fail closed）', async () => {
    const tx = makeTx({
      accountingPeriod: { findFirst: vi.fn().mockResolvedValue({ id: 'p1', periodKey: '202608', status: 'CLOSED' }) },
    });
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));
    const res = await POST(makeRequest('post', { version: 1 }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('GL_PERIOD_CLOSED');
  });
});
