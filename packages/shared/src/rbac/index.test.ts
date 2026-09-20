import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALL_ACTION_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_ACTIONS,
  ROLES,
  SYSTEM_PERMISSIONS,
} from '../constants';
import {
  hasEffectivePermission,
  hasPermission,
  normalizePermissions,
  permissionsForRole,
  type RoleCode,
} from './index';

/**
 * ADR-0057（动态 RBAC）单测：
 * 1. hasEffectivePermission 语义（fail-closed、**禁止回退静态表**）；
 * 2. normalizePermissions 规范化；
 * 3. **seed 回填前置不变量**：shared 静态权限宇宙 / 每个内置角色的静态权限集 ⊆ prisma/seed.ts 注册的 DB 目录
 *    （缺码会导致 P1 seed 回填 fail loud → 生产 seed 失败；本测试让该前置在 CI 即被机器校验）；
 * 4. **切换前后等价性矩阵**：5 内置角色 × 静态权限宇宙，hasPermission（静态）≡ hasEffectivePermission（DB 集）。
 */

const ROLE_CODES = Object.values(ROLES) as RoleCode[];

const STATIC_UNIVERSE = [
  ...new Set<string>([...ALL_ACTION_PERMISSIONS, ...SYSTEM_PERMISSIONS, ...Object.values(PERMISSIONS)]),
];

/** 定位 prisma/seed.ts（vitest cwd 可能是 packages/shared 或仓库根） */
function seedSource(): string {
  const candidates = [
    resolve(process.cwd(), '../../prisma/seed.ts'),
    resolve(process.cwd(), 'prisma/seed.ts'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      '[rbac test] prisma/seed.ts not found (tried: ' + candidates.join(', ') + '); RBAC catalog invariant cannot be verified',
    );
  }
  return readFileSync(found, 'utf8');
}

/** DB 权限目录 = SEED_ACTION_MODULES × PERMISSION_ACTIONS + seed 中字面注册的 code（受限/系统/read-write） */
function parseSeedCatalog(): Set<string> {
  const seed = seedSource()
    .split('\n')
    .map((line) => line.split('//')[0])
    .join('\n');

  const actionBlock = seed.split('SEED_ACTION_MODULES')[1]?.split('] as const')[0];
  if (!actionBlock) throw new Error('[rbac test] SEED_ACTION_MODULES not found in prisma/seed.ts');
  const actionModules = actionBlock.split('"').filter((_, index) => index % 2 === 1);

  const literalCodes: string[] = [];
  for (const part of seed.split('code: "').slice(1)) {
    const code = part.split('"')[0];
    const rest = part.slice(part.indexOf('"') + 1).trimStart();
    if (rest.startsWith(', module:')) literalCodes.push(code);
  }

  const catalog = new Set<string>();
  for (const module of actionModules) {
    for (const action of PERMISSION_ACTIONS) catalog.add(module + ':' + action);
  }
  for (const code of literalCodes) catalog.add(code);
  return catalog;
}

describe('hasEffectivePermission — ADR-0057 动态 RBAC 判定', () => {
  it('命中 → true；未命中 → false', () => {
    expect(hasEffectivePermission(['role:view', 'role:edit'], 'role:edit')).toBe(true);
    expect(hasEffectivePermission(['role:view'], 'role:edit')).toBe(false);
  });

  it('fail-closed：空权限集 / 空判定码一律 false', () => {
    expect(hasEffectivePermission([], 'role:view')).toBe(false);
    expect(hasEffectivePermission(['role:view'], '')).toBe(false);
  });

  it('禁止回退静态表：空集时 SUPER_ADMIN 的静态权限也不放行', () => {
    // 静态判定（旧路径）为 true —— 新判定不得因角色名/静态映射而放行
    expect(hasPermission(['SUPER_ADMIN'], 'role:edit')).toBe(true);
    expect(hasEffectivePermission([], 'role:edit')).toBe(false);
    expect(hasEffectivePermission([], 'gl:create')).toBe(false);
  });

  it('只按权限码判定：持有无关权限码不放行', () => {
    expect(hasEffectivePermission(['item:view', 'item:create'], 'item:delete')).toBe(false);
  });
});

describe('normalizePermissions', () => {
  it('去重 + 排序，且不修改入参', () => {
    const input = ['b:view', 'a:view', 'b:view'];
    expect(normalizePermissions(input)).toEqual(['a:view', 'b:view']);
    expect(input).toEqual(['b:view', 'a:view', 'b:view']);
  });

  it('空输入 → 空数组（不得注入任何默认权限）', () => {
    expect(normalizePermissions([])).toEqual([]);
  });
});

describe('seed 回填前置不变量（shared 静态目录 ⊆ prisma/seed.ts DB 目录）', () => {
  const catalog = parseSeedCatalog();

  it('静态权限宇宙（动作 + 系统 + read/write 常量）全部已在 DB 目录注册', () => {
    const missing = STATIC_UNIVERSE.filter((code) => !catalog.has(code)).sort();
    expect(missing).toEqual([]);
  });

  it('每个内置角色的静态权限集全部已在 DB 目录注册（回填不会缺码 / 不会静默丢权限）', () => {
    const missingByRole: Record<string, string[]> = {};
    for (const role of ROLE_CODES) {
      const missing = permissionsForRole(role).filter((code) => !catalog.has(code)).sort();
      if (missing.length > 0) missingByRole[role] = missing;
    }
    expect(missingByRole).toEqual({});
  });
});

describe('切换前后等价性矩阵（静态 ≡ DB 权限集）', () => {
  it('5 个内置角色 × 静态权限宇宙：hasPermission ≡ hasEffectivePermission(permissionsForRole)', () => {
    const mismatches: string[] = [];
    for (const role of ROLE_CODES) {
      const effective = permissionsForRole(role);
      for (const code of STATIC_UNIVERSE) {
        if (hasEffectivePermission(effective, code) !== hasPermission([role], code)) {
          mismatches.push(role + ' ' + code);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('VIEWER 无任何权限；SUPER_ADMIN / ADMIN 覆盖全体静态宇宙', () => {
    expect(permissionsForRole('VIEWER')).toEqual([]);
    for (const role of ['SUPER_ADMIN', 'ADMIN'] as RoleCode[]) {
      const codes = new Set(permissionsForRole(role));
      expect(STATIC_UNIVERSE.filter((code) => !codes.has(code))).toEqual([]);
    }
  });
});
