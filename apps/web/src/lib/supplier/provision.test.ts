import { describe, it, expect, vi } from 'vitest';
import { ensureSupplierArchive, isSupplierArchiveType } from '@/lib/supplier/provision';

/**
 * 供应商档案自动建档（用户报告：「新增采购单供应商为空，没有关联到往来单位」）
 *
 * 契约：往来单位 type=SUPPLIER/BOTH ⇒ Supplier 档案存在（1:1 角色扩展），且
 * - 幂等：已有档案（含软删/停用）只复活不重建；
 * - 编码冲突（历史数据）→ 确定性候选，仍冲突则 fail loud（不静默改名/跳过）；
 * - 非供应商类型 → 完全不触碰 Supplier 表。
 */

type AnyArgs = Record<string, unknown>;

function makeTx(opts: {
  existing?: unknown;
  codeOwner?: Record<string, unknown>;
} = {}) {
  const supplierCreate = vi.fn((args: { data: AnyArgs }) => Promise.resolve({ id: 'sup-new', ...args.data }));
  const supplierUpdate = vi.fn((args: { data: AnyArgs }) => Promise.resolve({ id: 'sup-existing', ...args.data }));
  const roleUpsert = vi.fn().mockResolvedValue({ id: 'role-1' });
  const tx = {
    businessPartnerRole: { upsert: roleUpsert },
    supplier: {
      findFirst: vi.fn().mockResolvedValue(opts.existing ?? null),
      findUnique: vi.fn((args: { where: { code: string } }) =>
        Promise.resolve((opts.codeOwner ?? {})[args.where.code] ?? null),
      ),
      create: supplierCreate,
      update: supplierUpdate,
    },
  };
  return { tx: tx as never, txRaw: tx, supplierCreate, supplierUpdate, roleUpsert };
}

const partner = { id: 'bp-abcdef123456', code: 'BP-S-001', name: '华东供应商有限公司', type: 'SUPPLIER' as const };

describe('isSupplierArchiveType', () => {
  it('SUPPLIER / BOTH → true；CUSTOMER / 空 → false', () => {
    expect(isSupplierArchiveType('SUPPLIER')).toBe(true);
    expect(isSupplierArchiveType('BOTH')).toBe(true);
    expect(isSupplierArchiveType('CUSTOMER')).toBe(false);
    expect(isSupplierArchiveType(null)).toBe(false);
    expect(isSupplierArchiveType(undefined)).toBe(false);
  });
});

describe('ensureSupplierArchive — 往来单位 ⇒ 供应商档案', () => {
  it('供应商类型且无档案 → 建档（编码/名称沿用往来单位，状态 POTENTIAL）+ 同步 SUPPLIER 角色', async () => {
    const { tx, supplierCreate, roleUpsert } = makeTx();
    const created = await ensureSupplierArchive(tx, partner, 'u-1');
    expect(created).toMatchObject({ code: 'BP-S-001', name: '华东供应商有限公司', partnerId: partner.id });
    expect(supplierCreate).toHaveBeenCalledTimes(1);
    expect(roleUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { partnerId_roleType: { partnerId: partner.id, roleType: 'SUPPLIER' } },
        create: expect.objectContaining({ partnerId: partner.id, roleType: 'SUPPLIER', createdById: 'u-1' }),
      }),
    );
  });

  it('客户类型 → 返回 null，完全不触碰 Supplier / 角色表（客户不被误当供应商）', async () => {
    const { tx, txRaw, supplierCreate, roleUpsert } = makeTx();
    const result = await ensureSupplierArchive(tx, { ...partner, type: 'CUSTOMER' }, 'u-1');
    expect(result).toBeNull();
    expect(supplierCreate).not.toHaveBeenCalled();
    expect(roleUpsert).not.toHaveBeenCalled();
    expect(txRaw.supplier.findFirst).not.toHaveBeenCalled();
  });

  it('已有启用档案 → 幂等复用（不建、不改）', async () => {
    const existing = { id: 'sup-1', partnerId: partner.id, code: 'S-001', isActive: true, deletedAt: null };
    const { tx, supplierCreate, supplierUpdate } = makeTx({ existing });
    const result = await ensureSupplierArchive(tx, partner, 'u-1');
    expect(result).toBe(existing);
    expect(supplierCreate).not.toHaveBeenCalled();
    expect(supplierUpdate).not.toHaveBeenCalled();
  });

  it('已有软删/停用档案 → 复活（1:1 唯一，绝不重复建档）', async () => {
    const existing = { id: 'sup-1', partnerId: partner.id, code: 'S-001', isActive: false, deletedAt: new Date() };
    const { tx, supplierCreate, supplierUpdate } = makeTx({ existing });
    await ensureSupplierArchive(tx, partner, 'u-1');
    expect(supplierCreate).not.toHaveBeenCalled();
    expect(supplierUpdate).toHaveBeenCalledWith({
      where: { id: 'sup-1' },
      data: expect.objectContaining({ deletedAt: null, isActive: true }),
    });
  });

  it('往来单位编码已被其他供应商档案占用 → 使用确定性候选编码（编码-往来单位 id 尾段）', async () => {
    const { tx, supplierCreate } = makeTx({ codeOwner: { 'BP-S-001': { id: 'sup-other', partnerId: 'bp-other' } } });
    await ensureSupplierArchive(tx, partner, 'u-1');
    expect(supplierCreate).toHaveBeenCalledTimes(1);
    expect(supplierCreate.mock.calls[0][0].data.code).toBe('BP-S-001-123456');
  });

  it('候选编码全部被占用 → fail loud（不静默改名，交由调用方事务回滚）', async () => {
    const codeOwner: Record<string, unknown> = {
      'BP-S-001': { id: 'sup-a', partnerId: 'bp-a' },
      'BP-S-001-123456': { id: 'sup-b', partnerId: 'bp-b' },
      'BP-S-001-123456-2': { id: 'sup-c', partnerId: 'bp-c' },
      'BP-S-001-123456-3': { id: 'sup-d', partnerId: 'bp-d' },
    };
    const { tx, supplierCreate } = makeTx({ codeOwner });
    await expect(ensureSupplierArchive(tx, partner, 'u-1')).rejects.toThrow('SUPPLIER_ARCHIVE_CODE_EXHAUSTED');
    expect(supplierCreate).not.toHaveBeenCalled();
  });
});
