import { describe, it, expect } from 'vitest';
import { PERMISSION_ACTIONS, PERMISSION_MODULES } from '@nilier-crm/shared';
import {
  buildPermissionTree,
  domainCodes,
  filterPermissionTree,
  moduleCodes,
  permissionDomainOf,
  selectedCodeList,
  selectionState,
  treeStats,
  unclassifiedModules,
  withCodes,
  type PermissionCatalogItem,
} from '@/lib/frontend/permission-tree';

/**
 * 系统权限树单测（纯函数层）
 * 覆盖：域映射完整性（漂移可见）、三级树构建、三态选择、选择集运算不可变性、
 * 搜索过滤（中文/模块 slug/权限码）、统计与提交排序。
 */

function item(module: string, action: string): PermissionCatalogItem {
  const code = `${module}:${action}`;
  return { id: code, code, module, action, name: `${action} ${module}` };
}

const CATALOG: PermissionCatalogItem[] = [
  item('item', 'view'),
  item('item', 'create'),
  item('item', 'edit'),
  item('purchase-order', 'view'),
  item('purchase-order', 'approve'),
  item('gl', 'view'),
  item('role', 'view'),
  item('role', 'edit'),
];

describe('域映射（PERMISSION_MODULE_DOMAINS）', () => {
  it('shared PERMISSION_MODULES 全部已登记域（未归类回退必须为空）', () => {
    const unclassified = PERMISSION_MODULES.filter((m) => permissionDomainOf(m) === 'other');
    expect(unclassified).toEqual([]);
  });

  it('未登记模块回退 other（漂移可见，不静默丢弃）', () => {
    expect(permissionDomainOf('not-registered-module')).toBe('other');
    expect(unclassifiedModules([item('not-registered-module', 'view')])).toEqual(['not-registered-module']);
  });

  it('受限子资源模块与父模块同域', () => {
    expect(permissionDomainOf('purchase-order-line')).toBe('purchasing');
    expect(permissionDomainOf('supplier-invoice-line')).toBe('finance');
    expect(permissionDomainOf('inventory-adjustment')).toBe('inventory');
    expect(permissionDomainOf('customer-pool')).toBe('customer-project');
  });
});

describe('buildPermissionTree — 三级树（域 → 模块 → 动作）', () => {
  it('按域分组、模块内动作按 code 排序', () => {
    const tree = buildPermissionTree(CATALOG);
    const masterData = tree.find((d) => d.domain === 'master-data');
    expect(masterData).toBeDefined();
    const itemNode = masterData?.modules.find((m) => m.module === 'item');
    expect(itemNode?.permissions.map((p) => p.code)).toEqual(['item:create', 'item:edit', 'item:view']);

    const purchasing = tree.find((d) => d.domain === 'purchasing');
    expect(purchasing?.modules.map((m) => m.module)).toEqual(['purchase-order']);
    expect(purchasing?.modules[0]?.permissions.map((p) => p.action)).toEqual(['approve', 'view']);
  });

  it('空目录 → 空树（不产生空域节点）', () => {
    expect(buildPermissionTree([])).toEqual([]);
  });

  it('domainCodes/moduleCodes 展开全部权限码', () => {
    const tree = buildPermissionTree(CATALOG);
    const roleDomain = tree.find((d) => d.domain === 'system');
    expect(roleDomain).toBeDefined();
    expect(domainCodes(roleDomain!).sort()).toEqual(['role:edit', 'role:view']);
    expect(moduleCodes(roleDomain!.modules[0]!).sort()).toEqual(['role:edit', 'role:view']);
  });
});

describe('selectionState — 三态', () => {
  it('全部选中 = all；部分选中 = partial；无选中 = none', () => {
    const codes = ['a:view', 'a:edit'];
    expect(selectionState(new Set(['a:view', 'a:edit']), codes)).toBe('all');
    expect(selectionState(new Set(['a:view']), codes)).toBe('partial');
    expect(selectionState(new Set(), codes)).toBe('none');
  });

  it('空节点视为 none', () => {
    expect(selectionState(new Set(['x:view']), [])).toBe('none');
  });
});

describe('withCodes / selectedCodeList — 选择集运算', () => {
  it('勾选与取消返回新集合，原集合不被修改', () => {
    const original = new Set(['item:view']);
    const added = withCodes(original, ['item:edit'], true);
    expect([...added].sort()).toEqual(['item:edit', 'item:view']);
    expect([...original]).toEqual(['item:view']);

    const removed = withCodes(added, ['item:view'], false);
    expect([...removed]).toEqual(['item:edit']);
  });

  it('提交列表为排序后的数组（全量替换语义稳定）', () => {
    expect(selectedCodeList(new Set(['b:view', 'a:edit', 'a:view']))).toEqual(['a:edit', 'a:view', 'b:view']);
  });
});

describe('filterPermissionTree — 搜索', () => {
  const tree = buildPermissionTree(CATALOG);

  it('空查询返回完整树', () => {
    expect(filterPermissionTree(tree, '   ')).toEqual(tree);
  });

  it('按权限码命中时只保留命中动作', () => {
    const result = filterPermissionTree(tree, 'purchase-order:approve');
    expect(result).toHaveLength(1);
    expect(result[0]?.domain).toBe('purchasing');
    expect(result[0]?.modules[0]?.permissions.map((p) => p.code)).toEqual(['purchase-order:approve']);
  });

  it('按模块中文名命中时保留该模块全部权限', () => {
    const result = filterPermissionTree(tree, '总账');
    expect(result).toHaveLength(1);
    expect(result[0]?.domain).toBe('finance');
    expect(result[0]?.modules[0]?.permissions.map((p) => p.code)).toEqual(['gl:view']);
  });

  it('按模块 slug 命中时保留该模块全部权限', () => {
    const result = filterPermissionTree(tree, 'item');
    const modules = result.flatMap((d) => d.modules.map((m) => m.module));
    expect(modules).toEqual(['item']);
  });

  it('无命中 → 空结果', () => {
    expect(filterPermissionTree(tree, 'no-such-permission')).toEqual([]);
  });
});

describe('treeStats — 统计', () => {
  it('统计总权限数、模块数与已选模块数', () => {
    const tree = buildPermissionTree(CATALOG);
    const stats = treeStats(tree, new Set(['item:view', 'role:view', 'role:edit']));
    expect(stats.total).toBe(CATALOG.length);
    expect(stats.selected).toBe(3);
    expect(stats.modules).toBe(4);
    expect(stats.selectedModules).toBe(2);
  });

  it('PERMISSION_ACTIONS 与 seed 动作集一致（10 动作，权限树动作层契约）', () => {
    expect([...PERMISSION_ACTIONS]).toEqual([
      'view',
      'create',
      'edit',
      'delete',
      'approve',
      'audit',
      'export',
      'import',
      'assign',
      'close',
    ]);
  });
});
