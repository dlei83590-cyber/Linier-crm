import { describe, it, expect } from 'vitest';
import {
  buildSupplierOptionViews,
  buildItemOptionViews,
  type SupplierOptionSource,
  type ItemOptionSource,
} from './supplier-options';

/**
 * FRT-02 回归测试：
 * - 供应商 selector 禁止 raw Supplier.id 回退——option.id 一律 = BusinessPartner.id（partner.id）；
 * - 无 partner 的 Supplier 行排除（无法作为 BP 引用）；
 * - 排除自身（后端禁自关联）与已关联供应商（避免重复 409）；
 * - 产品选项排除已关联 item（解除后再次关联完整闭环）。
 */
describe('buildSupplierOptionViews（禁 raw database ID）', () => {
  const sources: SupplierOptionSource[] = [
    { id: 'sup-1', code: 'S001', name: '上海电机厂', partner: { id: 'bp-10', name: '上海电机厂' } },
    { id: 'sup-2', code: 'S002', name: '苏州配件', partner: { id: 'bp-11', name: '苏州配件' } },
    // 无 partner 的 Supplier 行：无法映射到 BusinessPartner.id → 必须排除
    { id: 'sup-3', code: 'S003', name: '孤儿供应商', partner: null },
  ];

  it('option.id 必须取 partner.id（BusinessPartner.id），绝不回退到 Supplier.id', () => {
    const views = buildSupplierOptionViews(sources);
    expect(views.map((v) => v.id)).toEqual(['bp-10', 'bp-11']);
    expect(views.every((v) => !v.id.startsWith('sup-'))).toBe(true);
  });

  it('无 partner 的 Supplier 行被排除（禁止 partner?.id ?? option.id 回退）', () => {
    const views = buildSupplierOptionViews(sources);
    expect(views.some((v) => v.name === '孤儿供应商')).toBe(false);
  });

  it('排除自身（excludePartnerId）——后端禁自关联', () => {
    const views = buildSupplierOptionViews(sources, { excludePartnerId: 'bp-10' });
    expect(views.map((v) => v.id)).toEqual(['bp-11']);
  });

  it('排除已关联供应商（alreadyLinkedBpIds，BP id 集合）——避免重复关联 409', () => {
    const views = buildSupplierOptionViews(sources, { alreadyLinkedBpIds: ['bp-11'] });
    expect(views.map((v) => v.id)).toEqual(['bp-10']);
  });

  it('label 为「编码 — 名称」', () => {
    const views = buildSupplierOptionViews(sources);
    expect(views[0].label).toBe('S001 — 上海电机厂');
  });
});

describe('buildItemOptionViews（真实 Item selector）', () => {
  const items: ItemOptionSource[] = [
    { id: 'item-1', code: 'P001', name: '电机', model: 'M1' },
    { id: 'item-2', code: 'P002', name: '轴承', model: null },
  ];

  it('未关联 item 全部可选，option.id = Item.id', () => {
    const views = buildItemOptionViews(items);
    expect(views.map((v) => v.id)).toEqual(['item-1', 'item-2']);
    expect(views[0].label).toBe('P001 — 电机（M1）');
  });

  it('已关联 item 从选项排除；解除后重新出现（再次关联闭环）', () => {
    const linked = buildItemOptionViews(items, { alreadyLinkedItemIds: ['item-1'] });
    expect(linked.map((v) => v.id)).toEqual(['item-2']);
    const afterUnlink = buildItemOptionViews(items, { alreadyLinkedItemIds: [] });
    expect(afterUnlink.map((v) => v.id)).toEqual(['item-1', 'item-2']);
  });
});
