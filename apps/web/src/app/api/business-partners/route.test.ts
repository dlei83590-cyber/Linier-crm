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
vi.mock('@/lib/customer-pool/match', () => ({
  matchCustomerPools: vi.fn().mockResolvedValue({ matched: false, poolsMatched: [], entryCreated: false }),
}));

import { POST } from '@/app/api/business-partners/route';
import { matchCustomerPools } from '@/lib/customer-pool/match';

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

let bpMock: {
  findUnique: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
};

let usccRows: BpRow[] = [];
let bpRows: BpRow[] = [];
let createImpl: ((args: unknown) => Promise<unknown>) | null = null;

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/business-partners', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const baseBody = {
  code: 'BP-NEW-001',
  name: '新客户有限公司',
  type: 'CUSTOMER',
};

describe('POST /api/business-partners — Phase 2B create guard', () => {
  beforeEach(() => {
    usccRows = [];
    bpRows = [];
    createImpl = null;
    vi.clearAllMocks();
    bpMock = {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn(({ where }: { where?: Record<string, unknown> }) => {
        if (where && 'uscc' in where) return Promise.resolve(usccRows);
        return Promise.resolve(bpRows);
      }),
      create: vi.fn((args: unknown) =>
        createImpl ? createImpl(args) : Promise.resolve({ id: 'bp-new', code: 'BP-NEW-001', name: '新客户有限公司', type: 'CUSTOMER' }),
      ),
    };
    mockPrisma['businessPartner'] = bpMock;
    mockPrisma['partnerContact'] = { findMany: vi.fn().mockResolvedValue([]) };
  });

  it('14. EXACT create → 409 DUPLICATE_EXACT（阻断，ack 不能绕过见 15）', async () => {
    usccRows = [bp({ id: 'p1', name: '已有公司', uscc: '91310000MA1K35L88U' })];
    const res = await POST(makeRequest({ ...baseBody, uscc: '91310000MA1K35L88U' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('DUPLICATE_EXACT');
    expect(bpMock.create).not.toHaveBeenCalled();
  });

  it('15. EXACT + acknowledgement → 仍 409 DUPLICATE_EXACT', async () => {
    usccRows = [bp({ id: 'p1', name: '已有公司', uscc: '91310000MA1K35L88U' })];
    const res = await POST(makeRequest({ ...baseBody, uscc: '91310000MA1K35L88U', duplicateAcknowledged: true }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('DUPLICATE_EXACT');
    expect(bpMock.create).not.toHaveBeenCalled();
  });

  it('15b. soft-deleted 同 USCC create → 409 + 恢复/处理提示文案', async () => {
    usccRows = [bp({ id: 'p1', name: '已删公司', uscc: '91310000MA1K35L88U', deletedAt: new Date('2026-01-01') })];
    const res = await POST(makeRequest({ ...baseBody, uscc: '91310000MA1K35L88U' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('DUPLICATE_EXACT');
    expect(body.error.message).toContain('归档/删除');
  });

  it('16. POTENTIAL 无 ack → 409 DUPLICATE_REQUIRES_ACK', async () => {
    bpRows = [bp({ id: 'p1', name: '上海某某科技有限公司' })];
    const res = await POST(makeRequest({ ...baseBody, name: '上海某某科技有限公司' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('DUPLICATE_REQUIRES_ACK');
    expect(bpMock.create).not.toHaveBeenCalled();
  });

  it('17. POTENTIAL + ack → 201 创建成功', async () => {
    bpRows = [bp({ id: 'p1', name: '上海某某科技有限公司' })];
    const res = await POST(makeRequest({ ...baseBody, name: '上海某某科技有限公司', duplicateAcknowledged: true }));
    expect(res.status).toBe(201);
    expect(bpMock.create).toHaveBeenCalledTimes(1);
  });

  it('18. POTENTIAL + ack → 写 business-partner.duplicate-acknowledged Audit', async () => {
    bpRows = [bp({ id: 'p1', name: '上海某某科技有限公司' })];
    await POST(makeRequest({ ...baseBody, name: '上海某某科技有限公司', duplicateAcknowledged: true }));
    const calls = (await import('@/lib/api-helpers')).writeAuditLog as ReturnType<typeof vi.fn>;
    const ackCall = calls.mock.calls.find((c: unknown[]) => (c[0] as { action: string }).action === 'business-partner.duplicate-acknowledged');
    expect(ackCall).toBeTruthy();
    const data = (ackCall![0] as { afterData: { matchedPartnerIds: string[]; matchReasons: string[] } }).afterData;
    expect(data.matchedPartnerIds).toEqual(['p1']);
    expect(data.matchReasons).toContain('NAME_EXACT');
  });

  it('18b. EXACT create 阻断 → 写 business-partner.duplicate-blocked Audit', async () => {
    usccRows = [bp({ id: 'p1', name: '已有公司', uscc: '91310000MA1K35L88U' })];
    await POST(makeRequest({ ...baseBody, uscc: '91310000MA1K35L88U' }));
    const calls = (await import('@/lib/api-helpers')).writeAuditLog as ReturnType<typeof vi.fn>;
    const blockedCall = calls.mock.calls.find((c: unknown[]) => (c[0] as { action: string }).action === 'business-partner.duplicate-blocked');
    expect(blockedCall).toBeTruthy();
  });

  it('NONE → 201（无打扰直通）', async () => {
    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(201);
  });

  it('20. 并发 USCC P2002（matcher NONE 但 create 撞唯一约束）→ 409 DUPLICATE_EXACT', async () => {
    createImpl = () =>
      Promise.reject(Object.assign(new Error('unique constraint'), { code: 'P2002', meta: { target: ['uscc'] } }));
    const res = await POST(makeRequest({ ...baseBody, uscc: '91310000MA1K35L88U' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('DUPLICATE_EXACT');
    expect(body.error.message).toContain('并发');
  });

  it('21. code P2002 仍保持既有 code conflict（不误报为客户重复）', async () => {
    createImpl = () =>
      Promise.reject(Object.assign(new Error('unique constraint'), { code: 'P2002', meta: { target: ['code'] } }));
    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT');
  });

  it('21b. 其他唯一约束 P2002 → 500 统一错误处理（不误报重复）', async () => {
    createImpl = () =>
      Promise.reject(Object.assign(new Error('unique constraint'), { code: 'P2002', meta: { target: ['mnemonic'] } }));
    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(500);
  });

  it('22. 409 details.matches 不泄漏完整电话/USCC（仅 masked）', async () => {
    usccRows = [bp({ id: 'p1', name: '已有公司', uscc: '91310000MA1K35L88U', phone: '13812340000' })];
    const res = await POST(makeRequest({ ...baseBody, uscc: '91310000MA1K35L88U' }));
    const body = await res.json();
    const m = body.error.details.matches[0];
    expect(m.phoneMasked).toBe('138****0000');
    expect(m.usccMasked).toBe('9131****88U');
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('13812340000');
    expect(raw).not.toContain('91310000MA1K35L88U');
  });

  it('USCC 大小写/空格归一后 create 成功且 DB 存 normalized', async () => {
    const res = await POST(makeRequest({ ...baseBody, uscc: ' 9131 0000 ma1k 35l 88u ' }));
    expect(res.status).toBe(201);
    const createArgs = (bpMock.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArgs.data.uscc).toBe('91310000MA1K35L88U');
  });

  it('非法 USCC（长度/禁用字母）→ 400 VALIDATION_ERROR', async () => {
    const res = await POST(makeRequest({ ...baseBody, uscc: '91310000MA1K35L88I' }));
    expect(res.status).toBe(400);
  });

  it('23. 创建成功 → 调用 matchCustomerPools（自动入池钩子；best-effort 不回滚主档）', async () => {
    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(201);
    expect(matchCustomerPools).toHaveBeenCalledTimes(1);
    expect(matchCustomerPools).toHaveBeenCalledWith('bp-new');
  });
});
