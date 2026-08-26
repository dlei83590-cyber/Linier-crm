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
vi.mock('@/lib/api/cas', () => ({ casUpdate: vi.fn() }));

import { GET, PATCH, DELETE } from '@/app/api/business-partners/[id]/route';
import { casUpdate } from '@/lib/api/cas';

const casMock = casUpdate as ReturnType<typeof vi.fn>;

/** 供应商型往来单位详情（含 Supplier 角色扩展 + SupplierItem 只读聚合，contract-supplier MVP） */
function partnerWithSupplier() {
  return {
    id: 'bp-sup-1',
    code: 'SUP-001',
    name: '华东供应商有限公司',
    type: 'SUPPLIER',
    creditRating: 'AA',
    settlementTerms: 'NET30',
    contactPerson: '张三',
    phone: '13800000000',
    email: 'z@example.com',
    address: '上海市',
    isActive: true,
    version: 1,
    deletedAt: null,
    suppliers: [
      {
        id: 'sup-1',
        code: 'S-001',
        name: '华东供应商有限公司',
        status: 'QUALIFIED',
        rating: 4,
        isPreferred: true,
        defaultLeadTime: 15,
        currency: 'CNY',
        settlements: [
          { id: 'st-1', paymentTerms: 'NET30', creditDays: 30, paymentMethod: 'TT', currency: 'CNY' },
        ],
        qualifications: [
          { id: 'q-1', qualType: 'ISO9001', qualName: 'ISO9001 质量体系认证', certNo: 'C-001', issueDate: '2025-01-01T00:00:00.000Z', expireDate: '2028-01-01T00:00:00.000Z', status: 'VALID' },
        ],
      },
    ],
    supplierItems: [
      { id: 'si-1', supplierCode: 'S-ITM-01', moq: '10', leadTime: 7, currency: 'CNY', purchasePrice: '12.5000', isPreferred: true, paymentTerm: 'NET30', item: { id: 'item-1', code: 'ITM-001', name: '轴承 6204', spec: '6204-2RS' } },
    ],
  };
}

function makeRequest(body: unknown, method = 'PATCH'): NextRequest {
  return new NextRequest('http://localhost/api/business-partners/bp-sup-1', {
    method,
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/business-partners/:id — 供应商档案聚合（contract-supplier MVP）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.businessPartner = {
      findFirst: vi.fn().mockResolvedValue(partnerWithSupplier()),
    };
  });

  it('供应商型往来单位 → 200 且返回 Supplier 角色扩展（结算/账期/资质）', async () => {
    const res = await GET(new NextRequest('http://localhost/api/business-partners/bp-sup-1'), { params: Promise.resolve({ id: 'bp-sup-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.suppliers).toHaveLength(1);
    expect(body.data.suppliers[0].status).toBe('QUALIFIED');
    expect(body.data.suppliers[0].settlements[0].creditDays).toBe(30); // 账期
    expect(body.data.suppliers[0].qualifications[0].qualType).toBe('ISO9001'); // 资质
    expect(body.data.creditRating).toBe('AA'); // 信用等级
  });

  it('供应商型往来单位 → 200 且返回供应物料关系（SupplierItem + item）', async () => {
    const res = await GET(new NextRequest('http://localhost/api/business-partners/bp-sup-1'), { params: Promise.resolve({ id: 'bp-sup-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.supplierItems).toHaveLength(1);
    expect(body.data.supplierItems[0].item.code).toBe('ITM-001');
    expect(body.data.supplierItems[0].supplierCode).toBe('S-ITM-01');
  });

  it('客户型往来单位（无 Supplier 扩展）→ 200 且 suppliers 为空数组不报错', async () => {
    mockPrisma.businessPartner = {
      findFirst: vi.fn().mockResolvedValue({
        id: 'bp-cust-1',
        code: 'CUS-001',
        name: '某客户',
        type: 'CUSTOMER',
        creditRating: null,
        version: 1,
        deletedAt: null,
        suppliers: [],
        supplierItems: [],
      }),
    };
    const res = await GET(new NextRequest('http://localhost/api/business-partners/bp-cust-1'), { params: Promise.resolve({ id: 'bp-cust-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.suppliers).toEqual([]);
    expect(body.data.supplierItems).toEqual([]);
  });

  it('不存在 → 404 NOT_FOUND', async () => {
    mockPrisma.businessPartner = { findFirst: vi.fn().mockResolvedValue(null) };
    const res = await GET(new NextRequest('http://localhost/api/business-partners/bp-x'), { params: Promise.resolve({ id: 'bp-x' }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('PATCH /api/business-partners/:id — 信用等级（creditRating）写入', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    casMock.mockResolvedValue({ outcome: 'OK' });
    mockPrisma.businessPartner = {
      findFirst: vi.fn().mockResolvedValue({ id: 'bp-sup-1', code: 'SUP-001', name: '华东供应商有限公司', version: 1 }),
    };
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) =>
      fn({
        businessPartner: {
          findFirst: vi.fn().mockResolvedValue({ id: 'bp-sup-1', code: 'SUP-001', name: '华东供应商有限公司', creditRating: 'AA', version: 2 }),
        },
        businessPartnerInvoiceInfo: { upsert: vi.fn() },
      }),
    );
  });

  it('creditRating 合法 → 200 且 casUpdate 携带 creditRating 持久化', async () => {
    const res = await PATCH(makeRequest({ version: 1, creditRating: 'AA' }), { params: Promise.resolve({ id: 'bp-sup-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.creditRating).toBe('AA');
    expect(casMock).toHaveBeenCalledWith(expect.anything(), 'businessPartner', 'bp-sup-1', 1, expect.objectContaining({ creditRating: 'AA' }));
  });

  it('creditRating 超过 100 字符 → 400 VALIDATION（fail closed）', async () => {
    const res = await PATCH(makeRequest({ version: 1, creditRating: 'X'.repeat(101) }), { params: Promise.resolve({ id: 'bp-sup-1' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(casMock).not.toHaveBeenCalled();
  });

  it('channel 合法枚举（经销）→ 200 且 casUpdate 携带 channel 持久化', async () => {
    const res = await PATCH(makeRequest({ version: 1, channel: '经销' }), { params: Promise.resolve({ id: 'bp-sup-1' }) });
    expect(res.status).toBe(200);
    expect(casMock).toHaveBeenCalledWith(expect.anything(), 'businessPartner', 'bp-sup-1', 1, expect.objectContaining({ channel: '经销' }));
  });

  it('channel 非法值 → 400 VALIDATION（固定枚举 fail closed）', async () => {
    const res = await PATCH(makeRequest({ version: 1, channel: '代理' }), { params: Promise.resolve({ id: 'bp-sup-1' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(casMock).not.toHaveBeenCalled();
  });

  it('版本冲突 → 409 VERSION_CONFLICT', async () => {
    casMock.mockResolvedValue({ outcome: 'CONFLICT' });
    const res = await PATCH(makeRequest({ version: 1, creditRating: 'AA' }), { params: Promise.resolve({ id: 'bp-sup-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('VERSION_CONFLICT');
  });
});

describe('DELETE /api/business-partners/:id — 引用检查仅统计未删除（deletedAt:null）引用', () => {
  let findFirstMock: ReturnType<typeof vi.fn>;

  /** 构造带 _count 的往来单位；counts 只统计未软删除的引用（历史草稿不计入） */
  function bpWithCounts(counts: Record<string, number>) {
    return {
      id: 'bp-del-1',
      _count: {
        suppliers: counts.suppliers ?? 0,
        customers: counts.customers ?? 0,
        opportunities: counts.opportunities ?? 0,
        projects: counts.projects ?? 0,
        partnerContacts: counts.partnerContacts ?? 0,
        partnerAddresses: counts.partnerAddresses ?? 0,
        partnerBankAccounts: counts.partnerBankAccounts ?? 0,
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock = vi.fn();
    mockPrisma.businessPartner = {
      findFirst: findFirstMock,
      update: vi.fn().mockResolvedValue({ id: 'bp-del-1', deletedAt: new Date() }),
    };
  });

  it('无任何引用 → 200 软删除', async () => {
    findFirstMock.mockResolvedValue(bpWithCounts({}));
    const res = await DELETE(new NextRequest('http://localhost/api/business-partners/bp-del-1', { method: 'DELETE' }), { params: Promise.resolve({ id: 'bp-del-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deleted).toBe(true);
    expect(mockPrisma.businessPartner.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'bp-del-1' } }));
  });

  it('存在未删除的有效引用（customers>0）→ 409 CONFLICT', async () => {
    findFirstMock.mockResolvedValue(bpWithCounts({ customers: 1 }));
    const res = await DELETE(new NextRequest('http://localhost/api/business-partners/bp-del-1', { method: 'DELETE' }), { params: Promise.resolve({ id: 'bp-del-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT');
  });

  it('往来单位不存在 → 404 NOT_FOUND', async () => {
    findFirstMock.mockResolvedValue(null);
    const res = await DELETE(new NextRequest('http://localhost/api/business-partners/bp-x', { method: 'DELETE' }), { params: Promise.resolve({ id: 'bp-x' }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
