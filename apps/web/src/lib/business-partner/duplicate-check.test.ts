import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: {} as Record<string, unknown> }));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

import { findBusinessPartnerDuplicates, maskPhone, maskUscc } from './duplicate-check';

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

type ContactRow = {
  partnerId: string;
  phone: string | null;
  mobile: string | null;
  partner: BpRow;
};

let usccRows: BpRow[] = [];
let bpRows: BpRow[] = [];
let contactRows: ContactRow[] = [];

function bp(partial: Partial<BpRow> & { id: string; name: string }): BpRow {
  return {
    code: 'BP-' + partial.id,
    type: 'CUSTOMER',
    isActive: true,
    uscc: null,
    phone: null,
    deletedAt: null,
    ...partial,
  };
}

function contact(partnerId: string, partial: Partial<Omit<ContactRow, 'partnerId' | 'partner'>> = {}): ContactRow {
  return {
    partnerId,
    phone: null,
    mobile: null,
    partner: bp({ id: partnerId, name: partnerId + '-公司' }),
    ...partial,
  };
}

describe('findBusinessPartnerDuplicates（Phase 2B matcher）', () => {
  beforeEach(() => {
    usccRows = [];
    bpRows = [];
    contactRows = [];
    vi.clearAllMocks();
    mockPrisma.businessPartner = {
      findMany: vi.fn(({ where }: { where?: Record<string, unknown> }) => {
        if (where && 'uscc' in where) return Promise.resolve(usccRows);
        return Promise.resolve(bpRows);
      }),
    };
    mockPrisma.partnerContact = {
      findMany: vi.fn().mockResolvedValue(contactRows),
    };
  });

  it('1. USCC 普通 exact → EXACT + USCC_EXACT', async () => {
    usccRows = [bp({ id: 'p1', name: '上海甲有限公司', uscc: '91310000MA1K35L88U' })];
    const r = await findBusinessPartnerDuplicates({ uscc: '91310000MA1K35L88U' });
    expect(r.duplicateLevel).toBe('EXACT');
    expect(r.matches[0].matchReasons).toEqual(['USCC_EXACT']);
    expect(r.matches[0].level).toBe('EXACT');
  });

  it('2. USCC lowercase/space normalization → EXACT', async () => {
    usccRows = [bp({ id: 'p1', name: '上海甲有限公司', uscc: '91310000MA1K35L88U' })];
    const r = await findBusinessPartnerDuplicates({ uscc: ' 9131 0000 ma1k 35l 88u ' });
    expect(r.duplicateLevel).toBe('EXACT');
    expect(r.matches[0].matchReasons).toEqual(['USCC_EXACT']);
  });

  it('3. soft-deleted 同 USCC → EXACT + USCC_EXACT_DELETED', async () => {
    usccRows = [bp({ id: 'p1', name: '上海甲有限公司', uscc: '91310000MA1K35L88U', deletedAt: new Date('2026-01-01') })];
    const r = await findBusinessPartnerDuplicates({ uscc: '91310000MA1K35L88U' });
    expect(r.duplicateLevel).toBe('EXACT');
    expect(r.matches[0].matchReasons).toEqual(['USCC_EXACT_DELETED']);
    expect(r.matches[0].isDeleted).toBe(true);
  });

  it('4. same normalized name → POTENTIAL + NAME_EXACT', async () => {
    bpRows = [bp({ id: 'p1', name: '上海某某科技有限公司' })];
    const r = await findBusinessPartnerDuplicates({ name: '上海某某科技有限公司' });
    expect(r.duplicateLevel).toBe('POTENTIAL');
    expect(r.matches[0].matchReasons).toContain('NAME_EXACT');
  });

  it('4b. 名称大小写/全角不同仍 NAME_EXACT（normalize 后）', async () => {
    bpRows = [bp({ id: 'p1', name: 'ABC Trading Co., Ltd.' })];
    const r = await findBusinessPartnerDuplicates({ name: 'abc trading co., ltd.' });
    expect(r.duplicateLevel).toBe('POTENTIAL');
    expect(r.matches[0].matchReasons).toContain('NAME_EXACT');
  });

  it('5. BusinessPartner phone → POTENTIAL + PARTNER_PHONE_EXACT', async () => {
    bpRows = [bp({ id: 'p1', name: '上海乙有限公司', phone: '021-1234-5678' })];
    const r = await findBusinessPartnerDuplicates({ phone: '021 1234 5678' });
    expect(r.duplicateLevel).toBe('POTENTIAL');
    expect(r.matches[0].matchReasons).toContain('PARTNER_PHONE_EXACT');
  });

  it('6. PartnerContact mobile → POTENTIAL + CONTACT_MOBILE_EXACT', async () => {
    contactRows = [contact('p1', { mobile: '138 1234 0000' })];
    const r = await findBusinessPartnerDuplicates({ phone: '13812340000' });
    expect(r.duplicateLevel).toBe('POTENTIAL');
    expect(r.matches[0].matchReasons).toContain('CONTACT_MOBILE_EXACT');
  });

  it('7. PartnerContact phone → POTENTIAL + CONTACT_PHONE_EXACT', async () => {
    contactRows = [contact('p1', { phone: '021-1234-5678' })];
    const r = await findBusinessPartnerDuplicates({ contactMobile: '02112345678' });
    expect(r.duplicateLevel).toBe('POTENTIAL');
    expect(r.matches[0].matchReasons).toContain('CONTACT_PHONE_EXACT');
  });

  it('8. inactive BP potential 仍提示（停用≠主体不存在）', async () => {
    bpRows = [bp({ id: 'p1', name: '上海丙有限公司', isActive: false })];
    const r = await findBusinessPartnerDuplicates({ name: '上海丙有限公司' });
    expect(r.duplicateLevel).toBe('POTENTIAL');
    expect(r.matches[0].isActive).toBe(false);
  });

  it('9. deleted BP name/phone 不产生 POTENTIAL（deletedAt=null 过滤）', async () => {
    bpRows = [bp({ id: 'p1', name: '上海丁有限公司', phone: '02155556666', deletedAt: new Date('2026-01-01') })];
    const r = await findBusinessPartnerDuplicates({ name: '上海丁有限公司', phone: '02155556666' });
    expect(r.duplicateLevel).toBe('NONE');
    expect(r.matches).toEqual([]);
  });

  it('10. Supplier-only USCC → EXACT（提示复用主体，不重复建）', async () => {
    usccRows = [bp({ id: 'p1', name: '供应商戊', type: 'SUPPLIER', uscc: '91310000MA1K35L88U' })];
    const r = await findBusinessPartnerDuplicates({ uscc: '91310000MA1K35L88U' });
    expect(r.duplicateLevel).toBe('EXACT');
    expect(r.matches[0].type).toBe('SUPPLIER');
  });

  it('11. excludePartnerId 排除自身（编辑场景）', async () => {
    usccRows = [bp({ id: 'self', name: '自身公司', uscc: '91310000MA1K35L88U' })];
    const r = await findBusinessPartnerDuplicates({ uscc: '91310000MA1K35L88U', excludePartnerId: 'self' });
    expect(r.duplicateLevel).toBe('NONE');
    expect(r.matches).toEqual([]);
  });

  it('12. NONE（无任何匹配）', async () => {
    const r = await findBusinessPartnerDuplicates({ name: '不存在公司', uscc: '91310000MA1K35L88U', phone: '13900001111' });
    expect(r.duplicateLevel).toBe('NONE');
    expect(r.matches).toEqual([]);
  });

  it('matches 上限 10 且 EXACT 不被截断（detect 全量）', async () => {
    usccRows = Array.from({ length: 25 }, (_, i) => bp({ id: 'p' + i, name: '公司' + i, uscc: '91310000MA1K35L88U' }));
    const r = await findBusinessPartnerDuplicates({ uscc: '91310000MA1K35L88U' });
    expect(r.duplicateLevel).toBe('EXACT');
    expect(r.matches.length).toBe(10);
  });
});

describe('mask 函数（响应最小化，不泄漏完整值）', () => {
  it('maskPhone', () => {
    expect(maskPhone('13812340000')).toBe('138****0000');
    expect(maskPhone('+8613812340000')).toBe('+86****0000');
  });
  it('maskUscc', () => {
    expect(maskUscc('91310000MA1K35L88U')).toBe('9131****88U');
  });
});
