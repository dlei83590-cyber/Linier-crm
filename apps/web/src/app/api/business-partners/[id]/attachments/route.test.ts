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

import { POST, GET } from '@/app/api/business-partners/[id]/attachments/route';
import { DELETE } from '@/app/api/business-partners/[id]/attachments/[attachmentId]/route';

type TxMock = {
  businessPartner: { findFirst: ReturnType<typeof vi.fn> };
  file: { findFirst: ReturnType<typeof vi.fn> };
  fileAttachment: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
};

function makeTx(overrides: Partial<TxMock> = {}): TxMock {
  return {
    businessPartner: { findFirst: vi.fn().mockResolvedValue({ id: 'bp-1' }) },
    file: { findFirst: vi.fn().mockResolvedValue({ id: 'f-1' }) },
    fileAttachment: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'att-1', fileId: 'f-1', businessType: 'business-partner', businessId: 'bp-1' }),
    },
    ...overrides,
  };
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/business-partners/bp-1/attachments', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/business-partners/:id/attachments — 客户文档（复用 File Center）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(makeTx()));
  });

  it('挂载文件到客户 → 201（businessType=business-partner）', async () => {
    const tx = makeTx();
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest({ fileId: 'f-1', attachmentType: 'CERTIFICATE' }), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(res.status).toBe(201);
    const createArgs = (tx.fileAttachment.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArgs.data.businessType).toBe('business-partner');
    expect(createArgs.data.businessId).toBe('bp-1');
    expect(createArgs.data.attachmentType).toBe('CERTIFICATE');
  });

  it('文件不存在 → 404，create 不被调用', async () => {
    const tx = makeTx();
    tx.file.findFirst.mockResolvedValue(null);
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest({ fileId: 'f-missing' }), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(res.status).toBe(404);
    expect(tx.fileAttachment.create).not.toHaveBeenCalled();
  });

  it('同一文件重复挂载到同一客户 → 409', async () => {
    const tx = makeTx();
    tx.fileAttachment.findFirst.mockResolvedValue({ id: 'att-existing' });
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const res = await POST(makeRequest({ fileId: 'f-1' }), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(res.status).toBe(409);
    expect(tx.fileAttachment.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/business-partners/:id/attachments — 客户文档列表', () => {
  const faList = () => mockPrisma.fileAttachment as { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.businessPartner = { findFirst: vi.fn().mockResolvedValue({ id: 'bp-1' }) };
    mockPrisma.fileAttachment = {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([
        { id: 'att-1', file: { id: 'f-1', name: '营业执照.pdf', mimeType: 'application/pdf', size: 1024 } },
      ]),
    };
  });

  it('返回客户文档（含文件信息）', async () => {
    const res = await GET(new NextRequest('http://localhost/api/business-partners/bp-1/attachments'), { params: Promise.resolve({ id: 'bp-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].file.name).toBe('营业执照.pdf');
    // 查询限定 businessType=business-partner
    const findArgs = faList().findMany.mock.calls[0][0];
    expect(findArgs.where.businessType).toBe('business-partner');
  });
});

describe('DELETE /api/business-partners/:id/attachments/:attachmentId — 解除文档挂载', () => {
  const fa = () => mockPrisma.fileAttachment as { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.fileAttachment = {
      findFirst: vi.fn().mockResolvedValue({ id: 'att-1', fileId: 'f-1' }),
      update: vi.fn().mockResolvedValue({ id: 'att-1' }),
    };
  });

  it('软删除挂载（文件本身保留在 File Center）', async () => {
    const res = await DELETE(new NextRequest('http://localhost/api/business-partners/bp-1/attachments/att-1', { method: 'DELETE', headers: { authorization: 'Bearer test-token' } }), { params: Promise.resolve({ id: 'bp-1', attachmentId: 'att-1' }) });
    expect(res.status).toBe(200);
    const updateArgs = fa().update.mock.calls[0][0];
    expect(updateArgs.data.deletedAt).toBeInstanceOf(Date);
  });

  it('挂载不存在（或不属于该客户）→ 404', async () => {
    fa().findFirst.mockResolvedValue(null);
    const res = await DELETE(new NextRequest('http://localhost/api/business-partners/bp-1/attachments/att-x', { method: 'DELETE', headers: { authorization: 'Bearer test-token' } }), { params: Promise.resolve({ id: 'bp-1', attachmentId: 'att-x' }) });
    expect(res.status).toBe(404);
    expect(fa().update).not.toHaveBeenCalled();
  });
});
